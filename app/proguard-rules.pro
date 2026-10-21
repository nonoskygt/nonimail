# JavaMail / Jakarta Activation load handlers, providers and charsets by name.
-keep class com.sun.mail.** { *; }
-keep class javax.mail.** { *; }
-keep class javax.activation.** { *; }
-keep class com.sun.activation.** { *; }
-dontwarn java.awt.**
-dontwarn javax.naming.**
-dontwarn javax.security.sasl.**
-dontwarn javax.security.auth.callback.**
-dontwarn org.apache.harmony.**
-dontwarn sun.net.www.protocol.**
-dontwarn org.bouncycastle.**
# kotlinx.serialization keeps its own rules; the persisted models are @Serializable.
-keepclassmembers class com.nonosky.nonimailtools.** { *** Companion; }
-keepattributes *Annotation*, InnerClasses, Signature
-keep class com.nonosky.nonimailtools.core.Defaults** { *; }
# Open source app that users share logs from: keep readable class and method names in stack traces.
-dontobfuscate
