import java.time.Duration
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Every default of the app comes from gradle.properties (nmt.*) and is exposed as BuildConfig.
fun prop(name: String): String = providers.gradleProperty(name).orNull
    ?: error("Missing gradle property $name (see gradle.properties)")

fun quoted(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val versionNameValue = prop("nmt.versionName")
val versionCodeValue: Int = prop("nmt.versionCode").takeIf { it.isNotBlank() }?.toInt()
    ?: versionNameValue.split('.').map { it.toInt() }.let { (a, b, c) -> a * 10000 + b * 100 + c }

// Release signing: only from the environment (CI secrets or the local secrets folder).
// Without them the release build is signed with the debug key so it can still be tried.
val keystoreFile: String? = providers.environmentVariable("NMT_KEYSTORE_FILE").orNull?.takeIf { it.isNotBlank() }

android {
    namespace = "com.nonosky.nonimailtools"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "com.nonosky.nonimailtools"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = versionCodeValue
        versionName = versionNameValue

        buildConfigField("String", "SERVICE_URL", quoted(prop("nmt.serviceUrl")))
        buildConfigField("String", "REPO_URL", quoted(prop("nmt.repoUrl")))
        buildConfigField("int", "OLLAMA_PORT", prop("nmt.ollamaPort"))
        buildConfigField("String", "OLLAMA_MODEL", quoted(prop("nmt.ollamaModel")))
        buildConfigField("int", "OLLAMA_TIMEOUT_MS", prop("nmt.ollamaTimeoutMs"))
        buildConfigField("int", "IMAP_CONNECT_TIMEOUT_MS", prop("nmt.imapConnectTimeoutMs"))
        buildConfigField("int", "IMAP_TIMEOUT_MS", prop("nmt.imapTimeoutMs"))
        buildConfigField("int", "HTTP_TIMEOUT_MS", prop("nmt.httpTimeoutMs"))
        buildConfigField("String", "PRICE_CURRENCY", quoted(prop("nmt.priceCurrency")))
        buildConfigField("int", "PRICE_LIMPIAR", prop("nmt.priceLimpiar"))
        buildConfigField("int", "PRICE_SINCRONIZAR", prop("nmt.priceSincronizar"))
        buildConfigField("int", "LICENSE_DAYS", prop("nmt.licenseDays"))
        buildConfigField("String", "ORIGEN_DESCARGA", quoted(prop("nmt.origenDescarga")))
        buildConfigField("String", "UPDATE_REPO", quoted(prop("nmt.updateRepo")))
        buildConfigField("String", "UPDATE_API_BASE", quoted(prop("nmt.updateApiBase")))
        buildConfigField("String", "UPDATE_APK_ASSET", quoted(prop("nmt.updateApkAsset")))
        buildConfigField("String", "UPDATE_SUMS_ASSET", quoted(prop("nmt.updateSumsAsset")))
        buildConfigField("int", "UPDATE_MIN_HOURS", prop("nmt.updateMinHours"))
        buildConfigField("int", "UPDATE_PERIOD_HOURS", prop("nmt.updatePeriodHours"))
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("NMT_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NMT_KEY_ALIAS")
                keyPassword = System.getenv("NMT_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (keystoreFile != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/DEPENDENCIES", "META-INF/INDEX.LIST",
                "META-INF/versions/**", "META-INF/*.version", "META-INF/AL2.0", "META-INF/LGPL2.1",
                "META-INF/*.kotlin_module", "**/*.kotlin_builtins", "**/*.kotlin_metadata", "DebugProbesKt.bin",
                "doc-files/**", "org/bouncycastle/x509/**", "org/bouncycastle/**/*.properties",
            )
        }
    }

    lint {
        // lintVital would add ~1 GB of heap to every release build; CI runs lint separately if wanted.
        checkReleaseBuilds = false
        abortOnError = false
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
            isIncludeAndroidResources = true
            all { t ->
                t.maxHeapSize = "768m"
                t.timeout.set(Duration.ofMinutes(10))
                t.jvmArgs("-XX:+UseSerialGC")
                // Screenshot tests (Robolectric + Roborazzi) only run on request:
                //   ./gradlew :app:testDebugUnitTest -Pnmt.shotsDir=/path/to/shots
                val shots = providers.gradleProperty("nmt.shotsDir").orNull
                if (shots == null) {
                    t.exclude("**/Capturas*")
                } else {
                    t.systemProperty("nmt.shots.dir", shots)
                    t.systemProperty("roborazzi.test.record", "true")
                }
            }
        }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.fromTarget(libs.versions.jvmTarget.get())) }
}

dependencies {
    implementation(project(":core"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.litertlm.android)
    implementation(libs.play.services.auth)

    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
}
