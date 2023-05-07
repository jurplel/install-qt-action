# Upgrading `install-qt-action`

## Unreleased

## v3
* Updated `aqtinstall` to version 2.1.* by default.
  See [changelog entry](https://github.com/miurahr/aqtinstall/blob/master/docs/CHANGELOG.rst#v210-14-apr-2022) for details.
  * `aqtinstall` v 2.1.0 now checks that the SHA256 checksums reported at https://download.qt.io matches the 7z archives
    that it downloads [aqtinstall#493](https://github.com/miurahr/aqtinstall/pull/493). 
    This change was necessary because the old checksum algorithm, SHA1, is no longer safe to use for this purpose.
    Unfortunately, SHA256 checksums are often not available for up to 24 hours after new 7z archives are made available at
    https://download.qt.io, and workflows that use `aqtinstall` v 2.1.0 will fail to install Qt properly during that window.
    See [aqtinstall#578](https://github.com/miurahr/aqtinstall/issues/578) for further discussion.
