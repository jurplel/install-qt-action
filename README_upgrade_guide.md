# Upgrading `install-qt-action`

## Unreleased
* Updated `aqtinstall` to version 3.1.* by default.
* Use the `--autodesktop` flag to automatically install the desktop version of Qt, parallel to any WASM or mobile
  versions of Qt 6.2 and above.
  * If your action installed Qt 6.2+ for Android or WASM using `install-qt-action@v3`, then your action would have
    needed to install the desktop version of Qt alongside the WASM/mobile version of Qt, otherwise it would not have
    worked properly. As long as you are using `aqtinstall v3` or higher, the new version of `install-qt-action` will do
    that automatically, so you can remove the second step where you add the parallel desktop version of Qt.
    If you don't, your workflow will install desktop Qt twice.
* Added the `QT_ROOT_DIR` environment variable that points to the root of the Qt installation.
  This variable points to the same directory as the old `Qt5_DIR` and `Qt6_DIR` variables.
* Changed `Qt5_DIR` environment variable, so that it points to `${QT_ROOT_DIR}/lib/cmake`, as required by CMake.
  If your action uses this variable for any other purpose, you should update it to use `QT_ROOT_DIR` instead.
* Removed the `Qt5_Dir` and `Qt6_DIR` environment variables, because they are not used by CMake.
  If your action uses these variables, you should update them to use `QT_ROOT_DIR` instead.
* Any tools you installed with the `tools` key will be added to the beginning of your `PATH` environment variable.
  Specifically, any `bin` directories within the tool's directory will be added.
  On MacOS, if the tool is an app bundle, then the `.app/Contents/MacOS` folder will also be added to your `PATH`.
  * You should take care to investigate the order of the new `PATH` variable to make sure that the tools you are using
    are not clobbered by tools in some other path. You may need to rearrange the order of your workflow steps, so that
    any clobbered tools are added to the path later than the ones added by this action.
  * If the added tool paths are still causing trouble, you can remove them from the `PATH` by setting
    `add-tools-to-path: false`. 

## v3
* Updated `aqtinstall` to version 2.1.* by default.
  See [changelog entry](https://github.com/miurahr/aqtinstall/blob/master/docs/CHANGELOG.rst#v210-14-apr-2022) for details.
  * `aqtinstall` v 2.1.0 now checks that the SHA256 checksums reported at https://download.qt.io matches the 7z archives
    that it downloads [aqtinstall#493](https://github.com/miurahr/aqtinstall/pull/493). 
    This change was necessary because the old checksum algorithm, SHA1, is no longer safe to use for this purpose.
    Unfortunately, SHA256 checksums are often not available for up to 24 hours after new 7z archives are made available at
    https://download.qt.io, and workflows that use `aqtinstall` v 2.1.0 will fail to install Qt properly during that window.
    See [aqtinstall#578](https://github.com/miurahr/aqtinstall/issues/578) for further discussion.
