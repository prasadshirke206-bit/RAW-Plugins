# Shared native extractors

Each child directory is an independently sourced Kotlin extractor module. Keep provider-specific extractors beside their provider under `anime/providers/<provider>/`; place reusable hoster extractors here. These modules require native Android integration and are not directly executable by the QuickJS runtime.
