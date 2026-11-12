import Foundation

// MARK: - HTTP Transport Abstraction

public protocol AuralisHTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionHTTPTransport: AuralisHTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AuralisClientError.networkError("Invalid non-HTTP response")
        }
        return (data, http)
    }
}

// MARK: - Client Error Types

public enum AuralisClientError: Error, LocalizedError, Equatable, Sendable {
    case invalidBaseURL(String)
    case networkError(String)
    case serverError(statusCode: Int, detail: APIErrorDetail, retryAfterSeconds: Int?)
    case decodingError(String)

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let url):
            return "Invalid Auralis server URL: \(url)"
        case .networkError(let reason):
            return "Network connection error: \(reason)"
        case .serverError(_, let detail, let retryAfter):
            if let retryAfter = retryAfter {
                return "\(detail.message) (Retry after \(retryAfter)s)"
            }
            return detail.message
        case .decodingError(let reason):
            return "Unexpected server response format: \(reason)"
        }
    }

    /// Maps the client error to the appropriate `RecognitionState` per CONTRACT.md.
    public var mappedRecognitionState: RecognitionState {
        switch self {
        case .invalidBaseURL:
            return .serviceUnavailable
        case .networkError:
            return .connectionError
        case .serverError(_, let detail, _):
            return detail.typedCode.mappedRecognitionState
        case .decodingError:
            return .serviceUnavailable
        }
    }
}

// MARK: - Auralis API Client

public final class AuralisAPIClient: @unchecked Sendable {
    public static let installIdUserDefaultsKey = "com.auralis.ios.install_uuid"
    public static let defaultBaseURLString = "https://auralis-eight-kohl.vercel.app"

    private let lock = NSLock()
    private var _baseURL: URL
    private var _sessionToken: String?
    public let installId: String
    public let clientHeaderValue: String
    private let transport: AuralisHTTPTransport

    public var baseURL: URL {
        get { lock.withLock { _baseURL } }
        set { lock.withLock { _baseURL = newValue } }
    }

    public var sessionToken: String? {
        get { lock.withLock { _sessionToken } }
        set { lock.withLock { _sessionToken = newValue } }
    }

    public init(
        baseURL: URL = URL(string: AuralisAPIClient.defaultBaseURLString)!,
        installId: String? = nil,
        clientVersion: String = "1.0.0",
        platform: String = "ios",
        sessionToken: String? = nil,
        transport: AuralisHTTPTransport = URLSessionHTTPTransport()
    ) {
        self._baseURL = baseURL
        self._sessionToken = sessionToken
        self.clientHeaderValue = "\(platform)/\(clientVersion)"
        self.transport = transport

        if let provided = installId, !provided.isEmpty {
            self.installId = provided
        } else if let saved = UserDefaults.standard.string(forKey: Self.installIdUserDefaultsKey), !saved.isEmpty {
            self.installId = saved
        } else {
            let generated = UUID().uuidString.lowercased()
            UserDefaults.standard.set(generated, forKey: Self.installIdUserDefaultsKey)
            self.installId = generated
        }
    }

    // MARK: - Endpoints

    /// `GET /api/v1/config`
    public func fetchConfig() async throws -> ServerConfigResponse {
        let req = try buildRequest(path: "/api/v1/config", method: "GET")
        return try await performJSONRequest(req, responseType: ServerConfigResponse.self)
    }

    /// `POST /api/v1/recognize` (multipart/form-data)
    public func recognizeAudio(
        wavData: Data,
        source: String = "microphone",
        durationMs: Int,
        provider: String? = nil
    ) async throws -> RecognizeResponse {
        let boundary = "Boundary-Auralis-\(UUID().uuidString)"
        let body = Self.buildMultipartRecognizeBody(
            boundary: boundary,
            wavData: wavData,
            source: source,
            durationMs: durationMs,
            provider: provider
        )
        var req = try buildRequest(path: "/api/v1/recognize", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        return try await performJSONRequest(req, responseType: RecognizeResponse.self)
    }

    /// `GET /api/v1/shazamkit/token`
    public func fetchShazamKitToken() async throws -> ShazamKitTokenResponse {
        let req = try buildRequest(path: "/api/v1/shazamkit/token", method: "GET")
        return try await performJSONRequest(req, responseType: ShazamKitTokenResponse.self)
    }

    /// `POST /api/v1/auth/register`
    public func register(email: String, password: String) async throws -> AuthResponse {
        let payload = AuthCredentialsRequest(email: email, password: password)
        let req = try buildJSONRequest(path: "/api/v1/auth/register", method: "POST", body: payload)
        let response = try await performJSONRequest(req, responseType: AuthResponse.self)
        self.sessionToken = response.token
        return response
    }

    /// `POST /api/v1/auth/login`
    public func login(email: String, password: String) async throws -> AuthResponse {
        let payload = AuthCredentialsRequest(email: email, password: password)
        let req = try buildJSONRequest(path: "/api/v1/auth/login", method: "POST", body: payload)
        let response = try await performJSONRequest(req, responseType: AuthResponse.self)
        self.sessionToken = response.token
        return response
    }

    /// `GET /api/v1/library?since=<ISO>`
    public func fetchLibrary(since: String? = nil) async throws -> LibrarySyncResponse {
        var queryItems: [URLQueryItem] = []
        if let since = since, !since.isEmpty {
            queryItems.append(URLQueryItem(name: "since", value: since))
        }
        let req = try buildRequest(path: "/api/v1/library", method: "GET", queryItems: queryItems)
        return try await performJSONRequest(req, responseType: LibrarySyncResponse.self)
    }

    /// `POST /api/v1/library/sync`
    public func syncLibrary(items: [LibraryItem]) async throws -> LibrarySyncResponse {
        let payload = LibrarySyncRequest(items: items)
        let req = try buildJSONRequest(path: "/api/v1/library/sync", method: "POST", body: payload)
        return try await performJSONRequest(req, responseType: LibrarySyncResponse.self)
    }

    /// `DELETE /api/v1/library`
    public func clearRemoteLibrary() async throws {
        let req = try buildRequest(path: "/api/v1/library", method: "DELETE")
        _ = try await performRawRequest(req)
    }

    /// `DELETE /api/v1/account`
    public func deleteAccount() async throws {
        let req = try buildRequest(path: "/api/v1/account", method: "DELETE")
        _ = try await performRawRequest(req)
        self.sessionToken = nil
    }

    // MARK: - Multipart Builder

    public static func buildMultipartRecognizeBody(
        boundary: String,
        wavData: Data,
        source: String,
        durationMs: Int,
        provider: String?
    ) -> Data {
        var body = Data()
        let crlf = "\r\n"

        func appendText(_ string: String) {
            if let data = string.data(using: .utf8) {
                body.append(data)
            }
        }

        // Field: source
        appendText("--\(boundary)\(crlf)")
        appendText("Content-Disposition: form-data; name=\"source\"\(crlf)\(crlf)")
        appendText("\(source)\(crlf)")

        // Field: durationMs
        appendText("--\(boundary)\(crlf)")
        appendText("Content-Disposition: form-data; name=\"durationMs\"\(crlf)\(crlf)")
        appendText("\(durationMs)\(crlf)")

        // Optional Field: provider
        if let provider = provider, !provider.isEmpty {
            appendText("--\(boundary)\(crlf)")
            appendText("Content-Disposition: form-data; name=\"provider\"\(crlf)\(crlf)")
            appendText("\(provider)\(crlf)")
        }

        // File Field: audio
        appendText("--\(boundary)\(crlf)")
        appendText("Content-Disposition: form-data; name=\"audio\"; filename=\"sample.wav\"\(crlf)")
        appendText("Content-Type: audio/wav\(crlf)\(crlf)")
        body.append(wavData)
        appendText(crlf)

        appendText("--\(boundary)--\(crlf)")
        return body
    }

    // MARK: - Internal Request Execution

    public func buildRequest(
        path: String,
        method: String,
        queryItems: [URLQueryItem] = []
    ) throws -> URLRequest {
        let currentBase = self.baseURL
        guard var components = URLComponents(url: currentBase, resolvingAgainstBaseURL: false) else {
            throw AuralisClientError.invalidBaseURL(currentBase.absoluteString)
        }
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        components.path = basePath + normalizedPath
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw AuralisClientError.invalidBaseURL(currentBase.absoluteString)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 25
        request.setValue(clientHeaderValue, forHTTPHeaderField: "X-Auralis-Client")
        request.setValue(installId, forHTTPHeaderField: "X-Auralis-Install")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = self.sessionToken, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func buildJSONRequest<T: Encodable>(
        path: String,
        method: String,
        body: T
    ) throws -> URLRequest {
        var req = try buildRequest(path: path, method: method)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        return req
    }

    private func performRawRequest(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport.send(request)
        } catch let clientError as AuralisClientError {
            throw clientError
        } catch {
            throw AuralisClientError.networkError(error.localizedDescription)
        }

        guard (200..<300).contains(http.statusCode) else {
            let retryAfterHeader = http.value(forHTTPHeaderField: "Retry-After")
            let retryAfter = retryAfterHeader.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }
            if let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data) {
                throw AuralisClientError.serverError(
                    statusCode: http.statusCode,
                    detail: envelope.error,
                    retryAfterSeconds: retryAfter
                )
            } else {
                let fallbackCode = Self.defaultErrorCode(forStatusCode: http.statusCode)
                let detail = APIErrorDetail(
                    code: fallbackCode.rawValue,
                    message: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                    retryable: http.statusCode == 429 || http.statusCode >= 500
                )
                throw AuralisClientError.serverError(
                    statusCode: http.statusCode,
                    detail: detail,
                    retryAfterSeconds: retryAfter
                )
            }
        }
        return (data, http)
    }

    private func performJSONRequest<T: Decodable>(
        _ request: URLRequest,
        responseType: T.Type
    ) async throws -> T {
        let (data, _) = try await performRawRequest(request)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw AuralisClientError.decodingError(error.localizedDescription)
        }
    }

    private static func defaultErrorCode(forStatusCode statusCode: Int) -> AuralisAPIErrorCode {
        switch statusCode {
        case 401:
            return .unauthorized
        case 413:
            return .payloadTooLarge
        case 415:
            return .unsupportedFormat
        case 422:
            return .audioTooShort
        case 429:
            return .rateLimited
        case 503:
            return .providerUnavailable
        default:
            return .internalError
        }
    }
}
