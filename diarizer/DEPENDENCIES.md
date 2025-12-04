# Dependency Version Constraints

This file documents why specific library versions are pinned in `requirements.txt`.

## Current Version Pins (Updated 2025-12-04)

### PyTorch >= 2.8.0
**Current pin**: `torch>=2.8.0`
**Reason**: Required by WhisperX 3.7.4 for compatibility with latest features
**Date added**: 2025-12-04

**cuDNN Dependency**: PyTorch 2.8.0 automatically installs `nvidia-cudnn-cu12` (version 9.10.x) as a pip package dependency. No system-level cuDNN installation required.

### WhisperX == 3.7.4
**Current pin**: `whisperx==3.7.4`
**Reason**: Latest version with improved speaker detection and clustering parameter support
**Date added**: 2025-12-04

### PyTorch 2.6+ Model Loading Compatibility

**Issue**: PyTorch 2.6+ changed `torch.load(weights_only=True)` default for security.
This breaks loading of pyannote/WhisperX model checkpoints that contain library-specific classes.

**Solution**: Combined approach using environment variable + safe globals registration:

1. **Environment Variable** (run-wsl.sh line 39):
   - `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` - Disables weights-only mode for trusted checkpoints
   - This is the primary solution used by the WhisperX community
   - Required for pyannote model checkpoints that contain `pyannote.audio.core.model.Introspection` and other library classes

2. **Safe Globals Registration** (main.py lines 17-101):
   - Registers OmegaConf, PyTorch, and common classes explicitly
   - Provides partial protection while allowing model loading
   - Classes registered:
     - `omegaconf.dictconfig.DictConfig`
     - `omegaconf.listconfig.ListConfig`
     - `omegaconf.basecontainer.BaseContainer`
     - `omegaconf.base.Metadata`, `Box`, `SCMode`, `UnionNode`, etc.
     - `torch.torch_version.TorchVersion`
     - All `omegaconf.nodes.*` value types

**Date added**: 2025-12-04

**References**:
- [pyannote-audio #1908](https://github.com/pyannote/pyannote-audio/issues/1908) - PyTorch 2.6 compatibility
- [WhisperX #1304](https://github.com/m-bain/whisperX/issues/1304) - Environment variable solution
- [PyTorch Serialization Docs](https://pytorch.org/docs/stable/notes/serialization.html) - Security model

**Security Note**: The environment variable disables PyTorch's security enhancement, but this is acceptable
because we're loading trusted model checkpoints from Hugging Face (pyannote, WhisperX). For production,
ensure `HF_TOKEN` is properly secured and only load models from trusted sources.

## Historical Notes

Previous version constraints (PyTorch < 2.1.0, NumPy < 2.0) were superseded by
upgrades to WhisperX 3.7.4 and PyTorch 2.8.0. The NumPy 2.0 and torchaudio backend
issues have been resolved in newer library versions.
