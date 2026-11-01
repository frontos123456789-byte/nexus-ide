import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-all duration-150 outline-none focus-visible:ring-1 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-soft",
        secondary: "bg-hover text-foreground hover:bg-border-strong border border-border-strong",
        ghost: "text-subtle hover:bg-hover hover:text-foreground",
        outline: "border border-border-strong text-subtle hover:bg-hover hover:text-foreground",
        destructive: "bg-red-500/90 text-white hover:bg-red-500",
        success: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25",
      },
      size: {
        default: "h-8 px-3 mobile:h-10 mobile:px-4 mobile:text-sm",
        sm: "h-7 px-2.5 mobile:h-9 mobile:px-3 mobile:text-[13px]",
        xs: "h-6 px-2 text-[11px] mobile:h-8",
        icon: "size-7 mobile:size-9",
        "icon-sm": "size-6 mobile:size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
