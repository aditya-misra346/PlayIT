import Foundation
import Combine

// MARK: - Library Date Filter

public enum LibraryDateFilter: String, CaseIterable, Identifiable, Sendable {
    case all = "all"
    case today = "today"
    case last7Days = "last_7_days"
    case last30Days = "last_30_days"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .all:
            return "All Time"
        case .today:
            return "Today"
        case .last7Days:
            return "Last 7 Days"
        case .last30Days:
            return "Last 30 Days"
        }
    }

    public func includes(isoDateString: String, now: Date = Date()) -> Bool {
        if self == .all { return true }
        guard let date = LibraryStore.parseISO8601(isoDateString) else { return true }
        let calendar = Calendar.current
        switch self {
        case .all:
            return true
        case .today:
            return calendar.isDate(date, inSameDayAs: now)
        case .last7Days:
            guard let cutoff = calendar.date(byAdding: .day, value: -7, to: now) else { return true }
            return date >= cutoff
        case .last30Days:
            guard let cutoff = calendar.date(byAdding: .day, value: -30, to: now) else { return true }
            return date >= cutoff
        }
    }
}

// MARK: - Versioned On-Disk Schema

public struct LibraryDatabaseEnvelopeV1: Codable, Equatable, Sendable {
    public struct LegacyRecordV1: Codable, Equatable, Sendable {
        public let uuid: String
        public let track: TrackMatch
        public let isFavorite: Bool
        public let recognizedAt: String

        public init(uuid: String, track: TrackMatch, isFavorite: Bool, recognizedAt: String) {
            self.uuid = uuid
            self.track = track
            self.isFavorite = isFavorite
            self.recognizedAt = recognizedAt
        }
    }

    public let schemaVersion: Int
    public let records: [LegacyRecordV1]

    public init(schemaVersion: Int = 1, records: [LegacyRecordV1]) {
        self.schemaVersion = schemaVersion
        self.records = records
    }
}

public struct LibraryDatabaseEnvelopeV2: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 2

    public let schemaVersion: Int
    public var lastServerSyncAt: String?
    public var items: [LibraryItem]

    public init(
        schemaVersion: Int = LibraryDatabaseEnvelopeV2.currentSchemaVersion,
        lastServerSyncAt: String? = nil,
        items: [LibraryItem] = []
    ) {
        self.schemaVersion = schemaVersion
        self.lastServerSyncAt = lastServerSyncAt
        self.items = items
    }
}

// MARK: - Library Store (Metadata Only, Versioned Schema Migration)

@MainActor
public final class LibraryStore: ObservableObject {
    public static let currentSchemaVersion = LibraryDatabaseEnvelopeV2.currentSchemaVersion

    @Published public private(set) var allItemsIncludingTombstones: [LibraryItem] = []
    @Published public private(set) var lastServerSyncAt: String?
    @Published public var searchQuery: String = ""
    @Published public var selectedArtist: String? = nil
    @Published public var dateFilter: LibraryDateFilter = .all
    @Published public var favoritesOnly: Bool = false

    private let fileURL: URL

    public init(fileURL: URL? = nil) {
        if let fileURL = fileURL {
            self.fileURL = fileURL
        } else {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? FileManager.default.temporaryDirectory
            let dir = appSupport.appendingPathComponent("Auralis", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            self.fileURL = dir.appendingPathComponent("library_v2.json")
        }
        loadFromDisk()
    }

    // MARK: - Active & Filtered Views

    /// Active (non-deleted) items sorted newest first by `createdAt`.
    public var activeItems: [LibraryItem] {
        allItemsIncludingTombstones
            .filter { $0.deleted != true }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// Distinct artists available across active items, sorted alphabetically.
    public var availableArtists: [String] {
        let set = Set(activeItems.map(\.track.artist).filter { !$0.isEmpty })
        return set.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    /// Items matching current search query, artist filter, date filter, and favorites filter.
    public var filteredItems: [LibraryItem] {
        filterItems(
            searchQuery: searchQuery,
            artist: selectedArtist,
            dateFilter: dateFilter,
            favoritesOnly: favoritesOnly
        )
    }

    public func filterItems(
        searchQuery: String = "",
        artist: String? = nil,
        dateFilter: LibraryDateFilter = .all,
        favoritesOnly: Bool = false,
        referenceDate: Date = Date()
    ) -> [LibraryItem] {
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)

        return activeItems.filter { item in
            if favoritesOnly && !item.favorite {
                return false
            }
            if let artist = artist, !artist.isEmpty {
                if item.track.artist.caseInsensitiveCompare(artist) != .orderedSame {
                    return false
                }
            }
            if !dateFilter.includes(isoDateString: item.createdAt, now: referenceDate) {
                return false
            }
            if !trimmedQuery.isEmpty {
                let q = trimmedQuery.lowercased()
                let titleMatch = item.track.title.lowercased().contains(q)
                let artistMatch = item.track.artist.lowercased().contains(q)
                let albumMatch = item.track.album?.lowercased().contains(q) ?? false
                let isrcMatch = item.track.isrc?.lowercased().contains(q) ?? false
                let genreMatch = item.track.genres.contains { $0.lowercased().contains(q) }
                if !(titleMatch || artistMatch || albumMatch || isrcMatch || genreMatch) {
                    return false
                }
            }
            return true
        }
    }

    // MARK: - Mutations

    @discardableResult
    public func addRecognizedTrack(_ track: TrackMatch, favorite: Bool = false, now: Date = Date()) -> LibraryItem {
        let nowIso = Self.formatISO8601(now)
        let newItem = LibraryItem(
            id: UUID().uuidString.lowercased(),
            track: track,
            favorite: favorite,
            createdAt: track.match.recognizedAt.isEmpty ? nowIso : track.match.recognizedAt,
            updatedAt: nowIso,
            deleted: nil
        )
        allItemsIncludingTombstones.insert(newItem, at: 0)
        saveToDisk()
        return newItem
    }

    public func toggleFavorite(itemId: String, now: Date = Date()) {
        guard let idx = allItemsIncludingTombstones.firstIndex(where: { $0.id == itemId }) else { return }
        allItemsIncludingTombstones[idx].favorite.toggle()
        allItemsIncludingTombstones[idx].updatedAt = Self.formatISO8601(now)
        saveToDisk()
    }

    public func setFavorite(forTrackId trackId: String, favorite: Bool, now: Date = Date()) {
        let nowIso = Self.formatISO8601(now)
        var changed = false
        for idx in allItemsIncludingTombstones.indices {
            if allItemsIncludingTombstones[idx].track.id == trackId && allItemsIncludingTombstones[idx].deleted != true {
                allItemsIncludingTombstones[idx].favorite = favorite
                allItemsIncludingTombstones[idx].updatedAt = nowIso
                changed = true
            }
        }
        if changed {
            saveToDisk()
        }
    }

    public func isTrackFavorited(trackId: String) -> Bool {
        activeItems.contains { $0.track.id == trackId && $0.favorite }
    }

    /// Marks an item as deleted (tombstone for sync compatibility) and persists immediately.
    public func deleteItem(id: String, now: Date = Date()) {
        guard let idx = allItemsIncludingTombstones.firstIndex(where: { $0.id == id }) else { return }
        allItemsIncludingTombstones[idx].deleted = true
        allItemsIncludingTombstones[idx].updatedAt = Self.formatISO8601(now)
        saveToDisk()
    }

    /// Clears all items locally (marks existing items deleted for sync or resets when requested).
    public func clearAll(keepTombstonesForSync: Bool = false, now: Date = Date()) {
        if keepTombstonesForSync {
            let nowIso = Self.formatISO8601(now)
            for idx in allItemsIncludingTombstones.indices {
                allItemsIncludingTombstones[idx].deleted = true
                allItemsIncludingTombstones[idx].updatedAt = nowIso
            }
        } else {
            allItemsIncludingTombstones.removeAll()
        }
        saveToDisk()
    }

    // MARK: - Cloud Sync Merge (Last-Write-Wins by updatedAt + Tombstones)

    /// Merges remote items from `/api/v1/library/sync` using last-write-wins by `updatedAt`.
    public func mergeRemoteItems(_ remoteItems: [LibraryItem], serverTime: String?) {
        var byId: [String: LibraryItem] = [:]
        for local in allItemsIncludingTombstones {
            byId[local.id] = local
        }

        for remote in remoteItems {
            if let existing = byId[remote.id] {
                if Self.isUpdatedAt(remote.updatedAt, newerThanOrEqualTo: existing.updatedAt) {
                    byId[remote.id] = remote
                }
            } else {
                byId[remote.id] = remote
            }
        }

        allItemsIncludingTombstones = byId.values.sorted { $0.createdAt > $1.createdAt }
        if let serverTime = serverTime {
            lastServerSyncAt = serverTime
        }
        saveToDisk()
    }

    // MARK: - Export JSON (Metadata Only)

    public func exportJSONData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(activeItems)
    }

    public func exportJSONString() -> String {
        guard let data = try? exportJSONData(),
              let str = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return str
    }

    // MARK: - Persistence & Versioned Schema Migration

    public func saveToDisk() {
        let envelope = LibraryDatabaseEnvelopeV2(
            schemaVersion: Self.currentSchemaVersion,
            lastServerSyncAt: lastServerSyncAt,
            items: allItemsIncludingTombstones
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(envelope) else { return }
        let dir = fileURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: fileURL, options: [.atomic])
    }

    public func loadFromDisk() {
        guard FileManager.default.fileExists(atPath: fileURL.path),
              let data = try? Data(contentsOf: fileURL) else {
            allItemsIncludingTombstones = []
            return
        }
        if let migrated = try? Self.migrateDataToV2(data) {
            self.allItemsIncludingTombstones = migrated.items
            self.lastServerSyncAt = migrated.lastServerSyncAt
            // If migrated from an older version, write back V2 atomically
            if migrated.wasMigrated {
                saveToDisk()
            }
        }
    }

    public struct MigrationResult: Equatable, Sendable {
        public let items: [LibraryItem]
        public let lastServerSyncAt: String?
        public let fromSchemaVersion: Int
        public let wasMigrated: Bool
    }

    /// Migrates raw JSON bytes from Schema V0 (bare `[TrackMatch]`), Schema V1 (`LibraryDatabaseEnvelopeV1`),
    /// or Schema V2 (`LibraryDatabaseEnvelopeV2`) to the current V2 structure.
    nonisolated public static func migrateDataToV2(_ data: Data) throws -> MigrationResult {
        let decoder = JSONDecoder()

        struct VersionProbe: Decodable {
            let schemaVersion: Int?
        }

        if let probe = try? decoder.decode(VersionProbe.self, from: data),
           let version = probe.schemaVersion {
            if version >= 2 {
                let v2 = try decoder.decode(LibraryDatabaseEnvelopeV2.self, from: data)
                return MigrationResult(
                    items: v2.items,
                    lastServerSyncAt: v2.lastServerSyncAt,
                    fromSchemaVersion: version,
                    wasMigrated: false
                )
            } else if version == 1 {
                let v1 = try decoder.decode(LibraryDatabaseEnvelopeV1.self, from: data)
                let migratedItems = v1.records.map { record in
                    LibraryItem(
                        id: record.uuid,
                        track: record.track,
                        favorite: record.isFavorite,
                        createdAt: record.recognizedAt,
                        updatedAt: record.recognizedAt,
                        deleted: nil
                    )
                }
                return MigrationResult(
                    items: migratedItems,
                    lastServerSyncAt: nil,
                    fromSchemaVersion: 1,
                    wasMigrated: true
                )
            }
        }

        // Fallback V0: bare array of `[LibraryItem]` or `[TrackMatch]`
        if let items = try? decoder.decode([LibraryItem].self, from: data) {
            return MigrationResult(
                items: items,
                lastServerSyncAt: nil,
                fromSchemaVersion: 0,
                wasMigrated: true
            )
        }

        let legacyTracks = try decoder.decode([TrackMatch].self, from: data)
        let migratedItems = legacyTracks.map { track in
            LibraryItem(
                id: UUID().uuidString.lowercased(),
                track: track,
                favorite: false,
                createdAt: track.match.recognizedAt,
                updatedAt: track.match.recognizedAt,
                deleted: nil
            )
        }
        return MigrationResult(
            items: migratedItems,
            lastServerSyncAt: nil,
            fromSchemaVersion: 0,
            wasMigrated: true
        )
    }

    // MARK: - Date Formatting Helpers

    nonisolated public static func formatISO8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    nonisolated public static func parseISO8601(_ string: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) {
            return date
        }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: string)
    }

    nonisolated private static func isUpdatedAt(_ lhs: String, newerThanOrEqualTo rhs: String) -> Bool {
        if let d1 = parseISO8601(lhs), let d2 = parseISO8601(rhs) {
            return d1 >= d2
        }
        return lhs >= rhs
    }
}
