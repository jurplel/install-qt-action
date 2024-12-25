# `install-qt-action`

Installing Qt on Github Actions workflows manually is the worst.

You know what's easier than dealing with that? Just using this:
```yml
    - name: Install Qt
      uses: jurplel/install-qt-action@v4
```

All done.

## Upgrade Guides
Each new major version of this project includes changes that can break workflows written to use an older version of
this project. These changes are summarized here, to help you upgrade your existing workflows.

[Upgrading `install-qt-action`](README_upgrade_guide.md)

## Options

### `version`
The desired version of Qt to install.

You can also pass in SimpleSpec version numbers, for example `6.2.*`.

Default: `5.15.2` (Last Qt 5 LTS)

**Please note that for Linux builds, Qt 6+ requires Ubuntu 20.04 or later.**

### `host`
This is the host platform of the Qt version you will be installing. It's unlikely that you will need to set this manually if you are just building.

For example, if you are building on Linux and targeting desktop, you would set host to `linux`. If you are building on Linux and targeting android, you would set host to `linux` also. The host platform is the platform that your application will build on, not its target platform.

Possible values: `windows`, `mac`, `linux` or `all_os`

Defaults to the current platform it is being run on.

### `target`
This is the target platform that you will be building for. You will want to set this if you are building for iOS or Android. Please note that iOS builds are supported only on macOS hosts and Win RT builds are only supported on Windows hosts.

Possible values: `desktop`, `android`, `ios`, `winrt` or `wasm`

Default: `desktop`

### `arch`
This is the target architecture that your program will be built for.

**Linux x86 packages are not supported by this action.** Qt does not offer pre-built Linux x86 packages. Please consider using your distro's repository or building it manually.

**Possible values:**

You can find a full list of architectures easily by using [this awesome website](https://ddalcino.github.io/aqt-list-server/).

**Default values:**

Windows w/ Qt < 5.6: `win64_msvc2013_64`

Windows w/ Qt >= 5.6 && Qt < 5.9: `win64_msvc2015_64`

Windows w/ Qt >= 5.9 && Qt < 5.15: `win64_msvc2017_64`

Windows w/ Qt >= 5.15 && Qt < 6.8: `win64_msvc2019_64`

Windows w/ Qt >= 6.8: `win64_msvc2022_64`

Android: `android_armv7`

WASM: `wasm_singlethread`

### `dir`
This is the directory prefix that Qt will be installed to.

For example, if you set dir to `${{ github.workspace }}/example/`, your bin folder will be located at `$GITHUB_WORKSPACE/example/Qt/5.15.2/{arch}/bin`.
When possible, access your Qt directory through the `QT_ROOT_DIR` environment variable; this will point to `$GITHUB_WORKSPACE/example/Qt/5.15.2/{arch}` in this case.

Default: `$RUNNER_WORKSPACE` (this is one folder above the starting directory)

### `install-deps`
Whether or not to automatically install Qt dependencies on Linux through `apt`.

Can be set to `nosudo` to stop it from using sudo, for example on a docker container where the user already has sufficient privileges.

Default: `true`

### `modules`
String with whitespace delimited list of additional addon modules to install, with each entry separated by a space. If you need one of these, you'll know it.

Possible values: `qtcharts`, `qtdatavis3d`, `qtpurchasing`, `qtvirtualkeyboard`, `qtwebengine`, `qtnetworkauth`, `qtwebglplugin`, `qtscript`, `debug_info`, and more

Default: none

### `archives`
String with whitespace delimited list of Qt archives to install, with each entry separated by a space. Typically you don't need this unless you are aiming for bare minimum installation. I would strongly advise reading the [aqtinstall docs](https://aqtinstall.readthedocs.io/en/latest/getting_started.html#installing-a-subset-of-qt-archives-advanced) before using this feature.

Possible values: `qtbase`, `qtsvg`, `qtdeclarative`, `qtgamepad`, `qtgraphicaleffects`, `qtimageformats`, `qtlocation`

Default: none

### `cache`

Whether to cache Qt automatically. If it is set to `true`, then Qt won't be downloaded if a cached version is available, but the environment variables will always be set, and essential build tools will always be installed.

Default: `false`

### `cache-key-prefix`

Prefix to be used for the cache key of the automatic cache.

Default: `install-qt-action`

### `setup-python`

Set this to false if you want to skip using setup-python to find/download a valid python version. If you are on a self-hosted runner, you will probably need to set this to false because setup-python [requires a very specific environment to work](https://github.com/actions/setup-python#using-setup-python-with-a-self-hosted-runner).

Default: `true`

### `tools`

Qt "tools" to be installed.
Specify the tool name and tool variant name separated by commas, and separate multiple tools with spaces.
If you wish to install all tools available for a given tool name, you can leave off the tool variant name.
I would advise reading the [aqtinstall docs](https://aqtinstall.readthedocs.io/en/latest/getting_started.html#installing-tools) for more info on installing tools.

For example, this value will install the most recent versions of QtIFW and QtCreator: 
```
    tools: 'tools_ifw tools_qtcreator,qt.tools.qtcreator'
```

You can find a full list of tools easily by using [this awesome website](https://ddalcino.github.io/aqt-list-server/).

### `add-tools-to-path`

When set to `true`, and the `tools` parameter is non-empty,
the following paths will be prepended to the `PATH` variable: 
* `Tools/**/bin`
* `*.app/Contents/MacOS`
* `*.app/**/bin`

Most tools end up in the `Tools` folder, and have a `bin` directory containing CLI tools.
On MacOS, several tools are packaged in `.app` bundles, and CLI tools are spread out among various `bin` folders
and the `Contents/MacOS` folder.

Distinct from, and not affected by, the `set-env` parameter.

Default: `true`

### `source`

Set this to `true` to install Qt source code. Incompatible with `aqtinstall < 2.0.4`.

Default: `false`

### `src-archives`

String with whitespace delimited list of source archives to install, with each entry separated by a space.
Has no effect unless `source` is set to `true`.
Useful to limit download size.

See the `--archives` flag for [aqt install-src](https://aqtinstall.readthedocs.io/en/latest/cli.html#install-src-command) for more details.
Use [aqt list-src](https://aqtinstall.readthedocs.io/en/latest/cli.html#list-src-command) to see available options.

Default: none

### `documentation`

Set this to `true` to install Qt documentation files. Incompatible with `aqtinstall < 2.0.4`.

Default: `false`

### `doc-archives`

String with whitespace delimited list of documentation archives to install, with each entry separated by a space.
Has no effect unless `documentation` is set to `true`.
Useful to limit download size.

See the `--archives` flag for [aqt install-doc](https://aqtinstall.readthedocs.io/en/latest/cli.html#install-doc-command) for more details.
Use [aqt list-doc](https://aqtinstall.readthedocs.io/en/latest/cli.html#list-doc-command) to see available options.

Default: none

### `doc-modules`

String with whitespace delimited list of documentation modules to install, with each entry separated by a space.
Has no effect unless `documentation` is set to `true`.
Each module contains extra documentation not included with the base installation.

See the `--modules` flag for [aqt install-doc](https://aqtinstall.readthedocs.io/en/latest/cli.html#install-doc-command) for more details.
Use [aqt list-doc](https://aqtinstall.readthedocs.io/en/latest/cli.html#list-doc-command) to see available options.

Default: none

### `examples`

Set this to `true` to install Qt example code. Incompatible with `aqtinstall < 2.0.4`.

Default: `false`

### `example-archives`

String with whitespace delimited list of example archives to install, with each entry separated by a space.
Has no effect unless `examples` is set to `true`.
Useful to limit download size.

See the `--archives` flag for [aqt install-example](https://aqtinstall.readthedocs.io/en/latest/cli.html#install-example-command) for more details.
Use [aqt list-example](https://aqtinstall.readthedocs.io/en/latest/cli.html#list-example-command) to see available options.

Default: none

### `example-modules`

String with whitespace delimited list of example modules to install, with each entry separated by a space.
Has no effect unless `examples` is set to `true`.
Each module contains extra examples not included with the base installation.

See the `--modules` flag for [aqt install-example](https://aqtinstall.readthedocs.io/en/latest/cli.html#install-example-command) for more details.
Use [aqt list-example](https://aqtinstall.readthedocs.io/en/latest/cli.html#list-example-command) to see available options.

Default: none

### `set-env`
Set this to false if you want to avoid setting environment variables for whatever reason.
Has no effect on `tools` paths; to modify these you must use `add-tools-to-path`.

Default: `true`

### `no-qt-binaries`

Set this to true if you want to skip installing Qt. 
This option is useful if you want to install tools, source, documentation, or examples.

Default: `false`

### `tools-only`

This is a synonym for `no-qt-binaries`. It only exists to preserve backwards compatibility.
If you set either `no-qt-binaries` or `tools-only` to `true`, you will skip installation of Qt.

Default: `false`

### `aqtsource`

The full specifier for a version of [aqtinstall](https://github.com/miurahr/aqtinstall) as passed to pip. For example: `git+https://github.com/miurahr/aqtinstall.git`. This is intended to be used to troubleshoot any bugs that might be caused or fixed by certain versions of aqtinstall. Note that when this is used, the value of `aqtversion` is ignored.

By default this is unset and ignored.

### `aqtversion`

Version of [aqtinstall](https://github.com/miurahr/aqtinstall) to use, given in the format used by pip, for example: `==0.7.1`, `>=0.7.1`, `==0.7.*`. This is intended to be used to troubleshoot any bugs that might be caused or fixed by certain versions of aqtinstall.

Default: `==3.1.*`

### `py7zrversion`
Version of py7zr in the same style as the aqtversion and intended to be used for the same purpose.

Default: `==0.20.*`

### `extra`
This input can be used to append arguments to the end of the aqtinstall command for any special purpose.

Example value: `--external 7z`

## Example with all arguments

```yml
    - name: Install Qt
      uses: jurplel/install-qt-action@v4
      with:
        version: '5.15.2'
        host: 'windows'
        target: 'desktop'
        arch: 'win64_msvc2019_64'
        dir: '${{ github.workspace }}/example/'
        install-deps: 'true'
        modules: 'qtcharts qtwebengine'
        archives: 'qtbase qtsvg'
        cache: 'false'
        cache-key-prefix: 'install-qt-action'
        setup-python: 'true'
        tools: 'tools_ifw tools_qtcreator,qt.tools.qtcreator'
        set-env: 'true'
        tools-only: 'false'
        aqtversion: '==3.1.*'
        py7zrversion: '==0.20.*'
        extra: '--external 7z'
```

## More info
For more in-depth and certifiably up-to-date documentation, check the documentation for aqtinstall [here](https://aqtinstall.readthedocs.io/en/latest/getting_started.html).

Any tools you installed with the `tools` key will be added to the beginning of your `PATH` environment variable.
Specifically, any `bin` directories within the tool's directory will be added.
On MacOS, if the tool is an app bundle, then the `.app/Contents/MacOS` folder will also be added to your `PATH`.

The Qt bin directory is appended to your `path` environment variable.
`Qt5_DIR` is also set appropriately for CMake if you are using Qt 5.
In addition, `QT_PLUGIN_PATH`, `QML2_IMPORT_PATH`, `PKG_CONFIG_PATH` and `LD_LIBRARY_PATH` are set accordingly. `IQTA_TOOLS` is set to the "Tools" directory if tools are installed as well.

Since the Qt bin directory is in your `path`, you will not need to set the `CMAKE_PREFIX_PATH` CMake variable.
If you wish to do so, you can set it to either `${QT_ROOT_DIR}` or to `${QT_ROOT_DIR}/lib/cmake`.

Big thanks to the [aqtinstall](https://github.com/miurahr/aqtinstall/) developer for making this easy. Please go support [miurahr](https://github.com/miurahr/aqtinstall), he did all of the hard work here ([his liberapay](https://liberapay.com/miurahr)).

This action is distributed under the [MIT license](LICENSE).

By using this action, you agree to the terms of Qt's licensing. See [Qt licensing](https://www.qt.io/licensing/) and [Licenses used by Qt](https://doc.qt.io/qt-5/licenses-used-in-qt.html).
