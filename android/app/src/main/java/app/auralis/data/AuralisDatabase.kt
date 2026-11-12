package app.auralis.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

/**
 * Room entity storing ONLY [app.auralis.model.LibraryItem] metadata.
 * Raw audio is never persisted.
 */
@Entity(
    tableName = "library_items",
    indices = [
        Index(value = ["track_id"]),
        Index(value = ["artist"]),
        Index(value = ["created_at"]),
        Index(value = ["favorite"]),
        Index(value = ["deleted"])
    ]
)
data class LibraryItemEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "track_id")
    val trackId: String,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "artist")
    val artist: String,

    @ColumnInfo(name = "album")
    val album: String?,

    @ColumnInfo(name = "year")
    val year: Int?,

    @ColumnInfo(name = "artwork_url")
    val artworkUrl: String?,

    @ColumnInfo(name = "provider")
    val provider: String,

    @ColumnInfo(name = "source")
    val source: String,

    @ColumnInfo(name = "favorite")
    val favorite: Boolean,

    @ColumnInfo(name = "created_at")
    val createdAt: String,

    @ColumnInfo(name = "updated_at")
    val updatedAt: String,

    @ColumnInfo(name = "deleted")
    val deleted: Boolean = false,

    @ColumnInfo(name = "track_json")
    val trackJson: String
)

@Dao
interface LibraryDao {

    @Query("SELECT * FROM library_items WHERE deleted = 0 ORDER BY created_at DESC")
    fun observeActiveItems(): Flow<List<LibraryItemEntity>>

    @Query("SELECT * FROM library_items ORDER BY updated_at DESC")
    suspend fun getAllItemsIncludingDeleted(): List<LibraryItemEntity>

    @Query("SELECT * FROM library_items WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): LibraryItemEntity?

    @Query("SELECT * FROM library_items WHERE track_id = :trackId AND deleted = 0 ORDER BY created_at DESC LIMIT 1")
    suspend fun getLatestActiveByTrackId(trackId: String): LibraryItemEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: LibraryItemEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(entities: List<LibraryItemEntity>)

    @Query("UPDATE library_items SET favorite = :favorite, updated_at = :updatedAt WHERE id = :id")
    suspend fun updateFavorite(id: String, favorite: Boolean, updatedAt: String)

    @Query("UPDATE library_items SET deleted = 1, updated_at = :updatedAt WHERE id = :id")
    suspend fun softDeleteById(id: String, updatedAt: String)

    @Query("DELETE FROM library_items")
    suspend fun hardClearAll()

    @Query("UPDATE library_items SET deleted = 1, updated_at = :updatedAt WHERE deleted = 0")
    suspend fun softClearAll(updatedAt: String)
}

@Database(
    entities = [LibraryItemEntity::class],
    version = 1,
    exportSchema = true
)
abstract class AuralisDatabase : RoomDatabase() {

    abstract fun libraryDao(): LibraryDao

    companion object {
        private const val DB_NAME = "auralis_library.db"

        /**
         * Explicit forward migration hook so schema upgrades preserve user history.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Reserved for future schema v2 additions; preserves all v1 rows intact.
            }
        }

        @Volatile
        private var instance: AuralisDatabase? = null

        fun getInstance(context: Context): AuralisDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AuralisDatabase::class.java,
                    DB_NAME
                )
                    .addMigrations(MIGRATION_1_2)
                    .build()
                    .also { instance = it }
            }
        }
    }
}
