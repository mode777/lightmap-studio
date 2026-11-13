/**
 * JSX declarations for @vscode-elements tags the app renders that the
 * vscode-workbench kit does not wrap. Follows the kit's own declaration
 * pattern (see vscode-workbench/elements/types).
 */
import type { CSSProperties, HTMLAttributes, Key, ReactNode, Ref } from "react";

type VscElementProps<T extends HTMLElement = HTMLElement> = Omit<HTMLAttributes<T>, "color"> & {
  ref?: Ref<T>;
  key?: Key;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  [key: `data-${string}`]: string | number | boolean | undefined;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "vscode-single-select": VscElementProps & { value?: string };
      "vscode-option": VscElementProps & { value?: string; selected?: boolean };
      "vscode-form-container": VscElementProps;
      "vscode-form-group": VscElementProps & { variant?: "horizontal" | "vertical" | "settings-group" };
      "vscode-label": VscElementProps;
      "vscode-form-helper": VscElementProps;
    }
  }
}
