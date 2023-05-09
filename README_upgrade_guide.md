# Upgrading `install-qt-action`

## Unreleased
* Added the `QT_ROOT_DIR` environment variable that points to the root of the Qt installation.
  This variable points to the same directory as the old `Qt5_DIR` and `Qt6_DIR` variables.
* Changed `Qt5_DIR` environment variable, so that it points to `${QT_ROOT_DIR}/lib/cmake`, as required by CMake.
  If your action uses this variable for any other purpose, you should update it to use `QT_ROOT_DIR` instead.
* Removed the `Qt5_Dir` and `Qt6_DIR` environment variables, because they are not used by CMake.
  If your action uses these variables, you should update them to use `QT_ROOT_DIR` instead.

## v3
* Updated `aqtinstall` to version 2.1.* by default.
  See [changelog entry](https://github.com/miurahr/aqtinstall/blob/master/docs/CHANGELOG.rst#v210-14-apr-2022) for details.
  * `aqtinstall` v 2.1.0 now checks that the SHA256 checksums reported at https://download.qt.io matches the 7z archives
    that it downloads [aqtinstall#493](https://github.com/miurahr/aqtinstall/pull/493). 
    This change was necessary because the old checksum algorithm, SHA1, is no longer safe to use for this purpose.
    Unfortunately, SHA256 checksums are often not available for up to 24 hours after new 7z archives are made available at
    https://download.qt.io, and workflows that use `aqtinstall` v 2.1.0 will fail to install Qt properly during that window.
    See [aqtinstall#578](https://github.com/miurahr/aqtinstall/issues/578) for further discussion.
