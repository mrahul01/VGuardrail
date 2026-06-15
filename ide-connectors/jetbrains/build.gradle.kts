plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.24"
    id("org.jetbrains.intellij") version "1.17.4"
}

group = "com.vguardrail"
version = "0.1.0"

repositories {
    mavenCentral()
}

// Target the 2024.1 platform (IntelliJ IDEA Community); the plugin uses only
// platform APIs, so it runs in PyCharm/WebStorm/GoLand/etc. as well.
intellij {
    version.set("2024.1.7")
    type.set("IC")
}

kotlin {
    jvmToolchain(17)
}

tasks {
    patchPluginXml {
        sinceBuild.set("241")
        untilBuild.set("252.*")
    }

    // No searchable-options needed for a two-field settings panel; skipping
    // keeps the build fast and avoids a headless IDE launch.
    buildSearchableOptions {
        enabled = false
    }
}
