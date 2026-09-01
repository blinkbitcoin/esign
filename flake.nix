{
  description = "react-native-esignature dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem
    (system: let
      inherit (nixpkgs) lib;
      pkgs = import nixpkgs {
        inherit system;
      };

      nativeBuildInputs = with pkgs;
        [
          # Active LTS, matching the house convention (blink-mobile pins
          # nodejs_24). package.json engines stays "^22.22.2 || >= 24.15" - that's the
          # *minimum* the library supports for consumers, not the dev pin.
          nodejs_24

          # Android (gradle) toolchain; the SDK itself is managed by
          # Android Studio / ANDROID_HOME, not nix (unlike blink-mobile's
          # full android-nixpkgs setup - deliberate, to not shadow an
          # existing working SDK install)
          jdk17

          # iOS tooling: CocoaPods is pinned via the Gemfile, so nix only
          # provides ruby + bundler
          ruby_3_3
          bundler

          # House conventions / repo tooling
          gnumake
          jq
          alejandra
        ]
        ++ lib.optionals stdenv.isDarwin [
          watchman
        ];
    in {
      devShells.default = pkgs.mkShell {
        inherit nativeBuildInputs;

        JAVA_HOME = pkgs.jdk17.home;

        shellHook = ''
          # Xcode build phases need to find the nix-provided node
          # (they don't inherit this shell's PATH)
          if [[ $(uname) == "Darwin" ]] && [ -d examples/react-native-demo/ios ]; then
            echo "export NODE_BINARY=\"$(command -v node)\"" > examples/react-native-demo/ios/.xcode.env.local
          fi
        '';
      };

      formatter = pkgs.alejandra;
    });
}
