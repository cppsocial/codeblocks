#!/usr/bin/env bash
set -eo pipefail

source "$(dirname "$0")/common.sh"

# Keep the WASI SDK and LLVM versions compatible. Each value can be overridden
# for an intentional toolchain upgrade.
EMSDK_VERSION=${EMSDK_VERSION:-4.0.22}
WASI_SDK_VERSION=${WASI_SDK_VERSION:-29.0}
WASI_SDK_MAJOR=${WASI_SDK_MAJOR:-29}
LLVM_VERSION=${LLVM_VERSION:-21.1.0}
LLVM_MAJOR=${LLVM_MAJOR:-21}

SCRIPT_DIR=$clangd_script_dir
WORKSPACE_DIR=$clangd_project_root
CLANGD_BUILD_ROOT=${CLANGD_BUILD_ROOT:-$(mktemp -d)}
mkdir -p "$CLANGD_BUILD_ROOT"
cd "$CLANGD_BUILD_ROOT"
echo "Working directory: $CLANGD_BUILD_ROOT"

# 1. Get Emscripten

if [[ -d emsdk ]]; then
    echo "Emscripten SDK already exists, skipping clone."
else
    git clone --branch "$EMSDK_VERSION" --depth 1 https://github.com/emscripten-core/emsdk
fi
pushd emsdk >/dev/null
./emsdk install "$EMSDK_VERSION"
./emsdk activate "$EMSDK_VERSION"
source ./emsdk_env.sh
popd >/dev/null

# 2. Prepare WASI sysroot

if [[ -d "wasi-sysroot-$WASI_SDK_VERSION" ]]; then
    echo "WASI sysroot already exists, skipping download."
else
    wget -O- \
      "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_MAJOR/wasi-sysroot-$WASI_SDK_VERSION.tar.gz" \
      | tar -xz
fi

# 3. Build LLVM

if [[ -d llvm-project ]]; then
    echo "LLVM project already exists, skipping clone."
else
    git clone --branch "llvmorg-$LLVM_VERSION" --depth 1 https://github.com/llvm/llvm-project
fi

cd llvm-project

## Build native tools first
cmake -G Ninja -S llvm -B build-native \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLVM_ENABLE_PROJECTS=clang
cmake --build build-native --target llvm-tblgen clang-tblgen

## Apply a patch for blocking stdin read
if [[ -f "$CLANGD_BUILD_ROOT/llvm-project/.patched-wait-stdin" ]]; then
    echo "Patch for wait_stdin already applied, skipping."
else
    git apply "$SCRIPT_DIR/wait-stdin.patch"
    touch "$CLANGD_BUILD_ROOT/llvm-project/.patched-wait-stdin"
fi

common_cmake_args=(
    -G Ninja -S llvm -B build
    -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DLLVM_TARGET_ARCH=wasm32-emscripten \
    -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasi \
    -DLLVM_TARGETS_TO_BUILD=WebAssembly \
    -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra" \
    \
    -DLLVM_TABLEGEN="$PWD/build-native/bin/llvm-tblgen" \
    -DCLANG_TABLEGEN="$PWD/build-native/bin/clang-tblgen" \
    \
    -DLLVM_BUILD_STATIC=ON \
    \
    -DBUILD_SHARED_LIBS=OFF \
    -DLLVM_BUILD_LLVM_DYLIB=OFF \
    -DLLVM_LINK_LLVM_DYLIB=OFF \
    -DCLANG_LINK_CLANG_DYLIB=OFF \
    \
    -DLLVM_ENABLE_LTO=Full \
    \
    -DLLVM_INCLUDE_EXAMPLES=OFF \
    -DLLVM_INCLUDE_TESTS=OFF \
    -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_INCLUDE_DOCS=OFF \
    -DLLVM_ENABLE_BINDINGS=OFF \
    \
    -DLLVM_BUILD_TOOLS=OFF \
    -DCLANG_BUILD_TOOLS=OFF \
    \
    -DLLVM_ENABLE_ASSERTIONS=OFF \
    -DLLVM_ENABLE_EH=OFF \
    -DLLVM_ENABLE_RTTI=OFF \
    -DLLVM_ENABLE_BACKTRACES=OFF \
    -DLLVM_ENABLE_UNWIND_TABLES=OFF \
    -DLLVM_ENABLE_CRASH_OVERRIDES=OFF \
    -DLLVM_ENABLE_TERMINFO=OFF \
    -DLLVM_ENABLE_PIC=OFF \
    -DLLVM_ENABLE_DUMP=OFF \
    -DLLVM_ENABLE_TELEMETRY=OFF \
    \
    -DLLVM_ENABLE_ZLIB=OFF \
    -DLLVM_ENABLE_ZSTD=OFF \
    -DLLVM_ENABLE_LIBXML2=OFF \
    -DCLANG_ENABLE_LIBXML2=OFF \
    -DLLVM_ENABLE_LIBEDIT=OFF \
    -DLLVM_ENABLE_LIBPFM=OFF \
    -DLLVM_ENABLE_CURL=OFF \
    -DLLVM_ENABLE_FFI=OFF \
    -DLLVM_ENABLE_HTTPLIB=OFF \
    \
    -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
    -DCLANG_ENABLE_OBJC_REWRITER=OFF \
    -DCLANG_PLUGIN_SUPPORT=OFF \
    \
    -DCLANGD_ENABLE_REMOTE=OFF \
    -DCLANGD_BUILD_DEXP=OFF \
    -DCLANGD_TIDY_CHECKS=OFF \
    -DCLANG_TIDY_ENABLE_STATIC_ANALYZER=OFF \
    -DCLANG_TIDY_ENABLE_QUERY_BASED_CUSTOM_CHECKS=OFF \
    -DCLANGD_DECISION_FOREST=OFF \
    -DCLANGD_MALLOC_TRIM=OFF \
    \
    -DCLANG_TOOLS_EXTRA_INCLUDE_DOCS=OFF
)

configure_clangd() {
    local linker_flags=$1
    emcmake cmake "${common_cmake_args[@]}" \
      -DCMAKE_CXX_FLAGS="-pthread -Dwait4=__syscall_wait4 -Os -flto=full -fvirtual-function-elimination" \
      -DCMAKE_EXE_LINKER_FLAGS="$linker_flags"
}

## Build clangd once to generate its resource headers.
configure_clangd "-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN"
cmake --build build --target clangd

## Copy the resource headers into the embedded WASI sysroot.
wasi_include="$CLANGD_BUILD_ROOT/wasi-sysroot-$WASI_SDK_VERSION/include"
cp -R "build/lib/clang/$LLVM_MAJOR/include/." "$wasi_include/"

## Re-link the production build with the sysroot embedded.
configure_clangd "-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME -s INITIAL_MEMORY=256MB -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=2GB -s STACK_SIZE=256kB -s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT -s ASSERTIONS -s ASYNCIFY -s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 4)' --embed-file=$wasi_include@/usr/include"
cmake --build build --target clangd

mkdir -p "$clangd_wasm_dir"
cp build/bin/clangd* "$clangd_wasm_dir/"
echo "Installed clangd artifacts in $clangd_wasm_dir"
