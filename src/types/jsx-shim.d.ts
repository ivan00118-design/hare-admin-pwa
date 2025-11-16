declare module "*.jsx" {
  import type { ComponentType } from "react";
  const C: ComponentType<any>;
  export default C;
}
