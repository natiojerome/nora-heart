# Security

Do not put credentials, personal conversation histories or vault values in issues,
pull requests or test reports. Reproduce problems with synthetic data.

Heart is an actively developed personal harness. Its optional YOLO mode deliberately
gives the assistant host-level access. Only enable it on infrastructure you control.
MCP credentials are server-side environment references. Vault values are visible to
the selected model during the active turn; do not assume the model provider is a
cryptographic secret boundary.
