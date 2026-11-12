# Auralis R8 rules.
# kotlinx.serialization, OkHttp, Room, Coil and Compose ship their own consumer rules.

# Keep @Serializable model companions/serializers (belt and braces on top of library rules).
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class app.auralis.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

# The optional ShazamKit provider is looked up reflectively so the main source set never
# references the flavor-only class.
-keep class app.auralis.recognition.shazamkit.ShazamKitProvider { <init>(...); }
-keep class com.shazam.shazamkit.** { *; }
-dontwarn com.shazam.shazamkit.**

# OkHttp optional platform integrations.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
