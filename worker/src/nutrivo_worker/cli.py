"""Command line entry point. Subcommands are added as their milestone lands (docs/11-milestones.md)."""
import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="nutrivo", description="Nutrivo worker commands")
    parser.add_subparsers(dest="command", metavar="command")
    parser.parse_args()
    parser.print_help()


if __name__ == "__main__":
    main()
