---
'@blinkbitcoin/esign-core': minor
'@blinkbitcoin/esign-react-native': minor
'@blinkbitcoin/esign-react': minor
---

Initial public feature set: provider-agnostic `ESignature` component (React
Native WebView + React web iframe/DocuSign.js) over a shared `SigningSource`
core with three modes — public URL, DocuSign Web Forms instances, and proxy
envelopes (Apollo). Apollo-free `/webform` subpath entries for minimal
Web Forms-only consumers.
