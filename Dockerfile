# Shared development and CI image. The Node version matches package.json's Volta pin.
FROM node:20.13.1-bookworm

ARG PNPM_VERSION=9.1.1

# Install pnpm with npm instead of using the Corepack shim bundled in Node.
# Older Corepack releases fail while verifying pnpm's rotated signing key.
# Keep this image focused on frontend development and testing. The separate
# LLVM-to-Wasm toolchain in scripts/clangd/build.sh runs on the host/CI runner.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack disable \
    && npm install --global pnpm@${PNPM_VERSION} \
    && pnpm --version

WORKDIR /workspace

# Install dependencies in the image so a container started without a bind
# mount is immediately usable. A bind mount in development can reuse the
# named node_modules volume declared by devcontainer.json.
COPY --chown=node:node package.json pnpm-lock.yaml .npmrc ./
# The package's prepare lifecycle needs scripts/, src/, and public/wasm, which
# are copied in the next layer. Install dependencies here without lifecycle
# scripts so this cacheable layer does not try to build an incomplete tree.
RUN pnpm install --frozen-lockfile --prefer-offline --ignore-scripts

COPY --chown=node:node . .

# Run the dependency lifecycle skipped above, then prepare the complete source
# tree. ensure-wasm will use the artifacts copied from public/wasm.
RUN pnpm rebuild esbuild \
    && pnpm run prepare

ENV NODE_ENV=development
EXPOSE 4173

USER node
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
