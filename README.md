# `install-qt-action`

Installing Qt on Github Actions workflows manually is the worst.

You know what's easier than dealing with that? Just using this:
```yml
    - name: Install Qt
      uses: jurplel/install-qt-action@v2
```

All done.

## Options

### `version`
The desired version of Qt to install.

Default: `5.12.9` (Latest LTS at the time of writing)

### `host`
This is the host platform of the Qt version you will be installing. It's unlikely that you will need to set this manually if you are just building.

For example, if you are building on Linux and targeting desktop, you would set host to `linux`. If you are building on Linux and targeting android, you would set host to `linux` also. The host platform is the platform that your application will build on, not its target platform.

Possible values: `windows`, `mac`, or `linux`

Defaults to the current platform it is being run on.

### `target`
This is the target platform that you will be building for. You will want to set this if you are building for iOS or Android. 

**Please note that iOS builds are supported only on macOS hosts**

Possible values: `desktop`, `android`, or `ios`

Default: `desktop`

### `arch`
This is the target architecture that your program will be built for. This is only used for Windows and Android.

**Linux x86 packages are not supported by this action.** Qt does not offer pre-built Linux x86 packages. Please consider using your distro's repository or building it manually.

**Possible values:**

Windows: `win64_msvc2017_64`, `win64_msvc2015_64`, `win32_msvc2015`, `win32_mingw53`, `win64_mingw73` or `win64_mingw81`

Android: `android_x86`, `android_armv7`

You can find a full list of architectures by checking the Updates.xml for your version/platform.
For Qt 5.12.9 on windows: https://download.qt.io/online/qtsdkrepository/windows_x86/desktop/qt5_5129/Updates.xml

**Default values:**

Windows w/ Qt < 5.6: `win64_msvc2013_64`

Windows w/ Qt >= 5.6 && Qt < 5.9: `win64_msvc2015_64`

Windows w/ Qt >= 5.9 && Qt < 5.15: `win64_msvc2017_64`

Windows w/ Qt >= 5.15: `win64_msvc2019_64`

Android: `android_armv7`

### `dir`
This is the directory prefix that Qt will be installed to.

For example, if you set dir to `${{ github.workspace }}/example/`, your bin folder will be located at `$GITHUB_WORKSPACE/example/Qt/5.12.9/(your_arch)/bin`. When possible, access your Qt directory through the `Qt5_DIR` environment variable.

Default: `$RUNNER_WORKSPACE` (this is one folder above the starting directory)

### `install-deps`
Whether or not to automatically install Qt dependencies on Linux (you probably want to leave this on).

Default: `true`

### `modules`
List of additional addon modules to install, with each entry seperated by a space. If you need one of these, you'll know it.

Possible values: `qtcharts`, `qtdatavis3d`, `qtpurchasing`, `qtvirtualkeyboard`, `qtwebengine`, `qtnetworkauth`, `qtwebglplugin`, `qtscript`, `debug_info`, possibly others

Default: none

### `mirror`
Forces a different Qt mirror in case there is a problem with the default.

If you have problems, you can try: `http://mirrors.ocf.berkeley.edu/qt/`

Default: none

### `cached`
If it is set to `true`, then Qt won't be downloaded, but the environment variables will be set, and essential build tools will be installed.

It can be used with [actions/cache](https://github.com/actions/cache), for example:

```
- name: Cache Qt
  id: cache-qt
  uses: actions/cache@v1
  with:
    path: ../Qt
    key: ${{ runner.os }}-QtCache

- name: Install Qt
  uses: jurplel/install-qt-action@v2
  with:
    cached: ${{ steps.cache-qt.outputs.cache-hit }}
```

Default: `false`

### `aqtversion`

Version of [aqtinstall](https://github.com/miurahr/aqtinstall) to use, given in the format used by pip, for example: `==0.7.1`, `>=0.7.1`, `==0.7.*`. This is intended to be used to troubleshoot any bugs that might be caused or fixed by certain versions of aqtinstall.

Default: `==0.9.7`

### `py7zrversion`
Version of py7zr in the same style as the aqtversion and intended to be used for the same purpose.

Default: `==0.10.1`

### `extra`
This input can be used to append arguments to the end of the aqtinstall command in case of special needs.

Example value: `--external 7z`

## Example with all arguments

```yml
    - name: Install Qt
      uses: jurplel/install-qt-action@v2
      with:
        version: '5.12.9'
        host: 'windows'
        target: 'desktop'
        arch: 'win64_msvc2017_64'
        dir: '${{ github.workspace }}/example/'
        install-deps: 'true'
        modules: 'qtcharts qtwebengine'
        mirror: 'http://mirrors.ocf.berkeley.edu/qt/'
        cached: 'false'
        aqtversion: '==0.9.7'
        py7zrversion: '==0.10.1'
        extra: '--external 7z'
```

## More info

The Qt bin directory is added to your `path` environment variable. `Qt5_DIR` is also set appropriately for cmake. 

Big thanks to the [aqtinstall](https://github.com/miurahr/aqtinstall/) developers for making this easy. Please go support them, they did all of the hard work here.

This action is distributed under the [MIT license](LICENSE).

By using this action, you agree to the terms of Qt's licensing. See [Qt licensing](https://www.qt.io/licensing/) and [Licenses used by Qt](https://doc.qt.io/qt-5/licenses-used-in-qt.html). 
