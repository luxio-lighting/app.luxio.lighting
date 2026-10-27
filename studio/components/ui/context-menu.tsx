import * as React from 'react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      data-slot="context-menu-content"
      className={cn('z-50 min-w-[8rem] max-h-(--radix-context-menu-content-available-height) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none', className)}
      {...props}
    />
  </ContextMenuPrimitive.Portal>;
}

function ContextMenuItem({ className, variant = 'default', ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }) {
  return <ContextMenuPrimitive.Item
    data-slot="context-menu-item"
    data-variant={variant}
    className={cn('relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive', className)}
    {...props}
  />;
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator };
