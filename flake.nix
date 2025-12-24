{
  description = "X to Obsidian - Scrape X bookmarks to Obsidian vault";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            nodejs_22
            typescript
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
