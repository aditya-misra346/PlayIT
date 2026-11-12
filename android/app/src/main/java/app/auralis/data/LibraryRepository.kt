package app.auralis.data

import app.auralis.model.LibraryItem
import app.auralis.model.TrackMatch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID

/**
 * Manages the user's recognized track history (`LibraryItem`), search/filtering, JSON export,
 * and last-write-wins synchronization with `/api/v1/library/sync`.
 */
class LibraryRepository(
    private val dao: LibraryDao
) {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    private val prettyJson = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
        prettyPrint = true
    }

    val activeItemsFlow: Flow<List<LibraryItem>> = dao.observeActiveItems().map { entities ->
        entities.mapNotNull { entityToModel(it) }
    }

    suspend fun saveRecognizedTrack(track: TrackMatch): LibraryItem {
        val nowIso = Instant.now().toString()
        val existing = dao.getLatestActiveByTrackId(track.id)
        val item = LibraryItem(
            id = existing?.id ?: UUID.randomUUID().toString(),
            track = track,
            favorite = existing?.favorite ?: false,
            createdAt = nowIso,
            updatedAt = nowIso,
            deleted = false
        )
        dao.upsert(modelToEntity(item))
        return item
    }

    suspend fun toggleFavorite(itemId: String): Boolean {
        val existing = dao.getById(itemId) ?: return false
        val newFav = !existing.favorite
        val nowIso = Instant.now().toString()
        dao.updateFavorite(itemId, newFav, nowIso)
        return newFav
    }

    suspend fun setFavoriteForTrack(track: TrackMatch, favorite: Boolean): LibraryItem {
        val nowIso = Instant.now().toString()
        val existing = dao.getLatestActiveByTrackId(track.id)
        if (existing != null) {
            dao.updateFavorite(existing.id, favorite, nowIso)
            val updated = existing.copy(favorite = favorite, updatedAt = nowIso)
            return entityToModel(updated) ?: LibraryItem(
                id = existing.id,
                track = track,
                favorite = favorite,
                createdAt = existing.createdAt,
                updatedAt = nowIso,
                deleted = false
            )
        } else {
            val created = LibraryItem(
                id = UUID.randomUUID().toString(),
                track = track,
                favorite = favorite,
                createdAt = nowIso,
                updatedAt = nowIso,
                deleted = false
            )
            dao.upsert(modelToEntity(created))
            return created
        }
    }

    suspend fun deleteItem(itemId: String) {
        val nowIso = Instant.now().toString()
        dao.softDeleteById(itemId, nowIso)
    }

    suspend fun clearAll(keepTombstonesForSync: Boolean) {
        if (keepTombstonesForSync) {
            dao.softClearAll(Instant.now().toString())
        } else {
            dao.hardClearAll()
        }
    }

    suspend fun getAllForSync(): List<LibraryItem> {
        return dao.getAllItemsIncludingDeleted().mapNotNull { entityToModel(it) }
    }

    /**
     * Merges remote items from `/api/v1/library/sync` using last-write-wins by `updatedAt`.
     */
    suspend fun mergeRemoteItems(remoteItems: List<LibraryItem>) {
        if (remoteItems.isEmpty()) return
        val toUpsert = mutableListOf<LibraryItemEntity>()
        for (remote in remoteItems) {
            val local = dao.getById(remote.id)
            if (local == null || remote.updatedAt >= local.updatedAt) {
                toUpsert.add(modelToEntity(remote))
            }
        }
        if (toUpsert.isNotEmpty()) {
            dao.upsertAll(toUpsert)
        }
    }

    suspend fun exportActiveLibraryJson(): String {
        val active = dao.getAllItemsIncludingDeleted()
            .filter { !it.deleted }
            .mapNotNull { entityToModel(it) }
        return prettyJson.encodeToString(active)
    }

    private fun modelToEntity(item: LibraryItem): LibraryItemEntity {
        val track = item.track
        return LibraryItemEntity(
            id = item.id,
            trackId = track.id,
            title = track.title,
            artist = track.artist,
            album = track.album,
            year = track.year,
            artworkUrl = track.artwork?.thumbUrl ?: track.artwork?.url,
            provider = track.match.provider,
            source = track.match.source,
            favorite = item.favorite,
            createdAt = item.createdAt,
            updatedAt = item.updatedAt,
            deleted = item.deleted,
            trackJson = json.encodeToString(track)
        )
    }

    private fun entityToModel(entity: LibraryItemEntity): LibraryItem? {
        val track = runCatching {
            json.decodeFromString<TrackMatch>(entity.trackJson)
        }.getOrNull() ?: return null

        return LibraryItem(
            id = entity.id,
            track = track,
            favorite = entity.favorite,
            createdAt = entity.createdAt,
            updatedAt = entity.updatedAt,
            deleted = entity.deleted
        )
    }
}
