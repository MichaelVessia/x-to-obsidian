{
  description = "X to Obsidian - Scrape X bookmarks to Obsidian vault";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    bun2nix,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      bun2nix' = bun2nix.packages.${system}.default;
    in {
      packages.default = pkgs.stdenv.mkDerivation {
        pname = "x-to-obsidian";
        version = "0.0.1";
        src = ./.;

        nativeBuildInputs = [
          bun2nix'.hook
          pkgs.makeBinaryWrapper
        ];

        bunDeps = bun2nix'.fetchBunDeps {
          bunNix = ./bun.nix;
        };

        # Skip default bun build (AOT compilation) - we'll run with bun interpreter
        dontUseBunBuild = true;
        dontUseBunCheck = true;
        dontUseBunInstall = true;

        installPhase = ''
          runHook preInstall

          mkdir -p $out/lib/x-to-obsidian
          cp -r . $out/lib/x-to-obsidian

          mkdir -p $out/bin
          makeBinaryWrapper ${pkgs.bun}/bin/bun $out/bin/x-to-obsidian \
            --add-flags "run $out/lib/x-to-obsidian/packages/server/src/index.ts"

          runHook postInstall
        '';
      };

      devShells.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          bun
          typescript
          bun2nix'
        ];

        shellHook = ''
          echo "x-to-obsidian dev shell"
          echo "Commands:"
          echo "  bun install                              - Install dependencies"
          echo "  bun run --filter @x-to-obsidian/server dev  - Start server"
          echo "  bun run --filter @x-to-obsidian/extension build - Build extension"
        '';
      };
    });
}
