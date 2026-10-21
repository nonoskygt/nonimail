// Pure Kotlin/JVM: all mail, license, scoring and telemetry logic lives here so it can be
// unit-tested on any JVM, without a device or Robolectric.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.fromTarget(libs.versions.jvmTarget.get())) }
}

dependencies {
    api(libs.android.mail)
    api(libs.android.activation)
    implementation(libs.bouncycastle.prov)
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.core)

    testImplementation(libs.junit)
    testImplementation(libs.greenmail)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test {
    maxHeapSize = "512m"
    // GreenMail binds local ports; one fork keeps the run predictable on small machines.
    maxParallelForks = 1
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
