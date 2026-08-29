# Shared development and CI image. The Node version matches package.json's Volta pin.
FROM node:20.13.1-bookworm

ARG PNPM_VERSION=9.1.1

# Install pnpm with npm instead of using the Corepack shim bundled in Node.
# Older Corepack releases fail while verifying pnpm's rotated signing key.
# Keep this image focused on frontend development and testing. The separate
# LLVM-to-Wasm toolchain in build.sh intentionally runs on the host/CI runner.
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
RUN pnpm install --frozen-lockfile --prefer-offline

COPY --chown=node:node . .

ENV NODE_ENV=development
EXPOSE 4173 4174 4175 4176

USER node
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
