# Dependency Version Constraints

This file documents why specific library versions are pinned in `requirements.txt`.

## Version Pins

### NumPy < 2.0.0
**Current pin**: `numpy>=1.24.0,<2.0.0`
**Reason**: pyannote.audio 3.1.1 uses `np.NaN` which was removed in NumPy 2.0 (replaced with `np.nan`)
**Error without pin**: `AttributeError: 'np.NaN' was removed in the NumPy 2.0 release. Use 'np.nan' instead.`
**Date added**: 2025-12-03

### PyTorch < 2.1.0
**Current pin**: `torch>=2.0.0,<2.1.0`
**Reason**: pyannote.audio 3.1.1 compatibility - newer versions may have breaking changes
**Date added**: 2025-12-03

### Torchaudio < 2.1.0
**Current pin**: `torchaudio>=2.0.0,<2.1.0`
**Reason**: pyannote.audio 3.1.1 calls `torchaudio.set_audio_backend()` which was deprecated and removed in torchaudio 2.1+
**Error without pin**: `AttributeError: module 'torchaudio' has no attribute 'set_audio_backend'`
**Date added**: 2025-12-03

## Upgrade Path

When upgrading pyannote.audio beyond 3.1.1:
1. Check if newer versions support NumPy 2.0+
2. Check if newer versions work with torchaudio 2.1+
3. Test with latest PyTorch versions
4. Update this file with new constraints

## References
- pyannote.audio GitHub issues: https://github.com/pyannote/pyannote-audio/issues
- WhisperX compatibility: whisperx 3.2.0 specifies pyannote.audio 3.1.1
