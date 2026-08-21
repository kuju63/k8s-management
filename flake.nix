{
  description = "react-seeded: Next.js SPA development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            git
            gh
            pnpm
            betterleaks
            kubectl
            kubernetes-helm
          ];

          shellHook = ''
            echo "dev shell"
            echo "  node:        $(node --version)"
            echo "  pnpm:        $(pnpm --version)"
            echo "  git:         $(git --version)"
            echo "  gh:          $(gh --version | head -n1)"
            echo "  betterleaks: $(betterleaks version)"
            echo "  kubectl:     $(kubectl version --client --output=yaml | head -n2 | tail -n1)"
          '';
        };
      });
}
