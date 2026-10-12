# Skeleton Loader Guidelines

Whenever the user asks for a loader or skeleton loader anywhere in the application:
1. Always use the standardized card-style skeleton loader design provided by `<LoadingSkeleton />` from `@/components/data/states`.
2. Do not render flat, empty solid dark rectangular bars.
3. Every skeleton card row must follow the established card aesthetic:
   - Container: `rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1`
   - Content:
     - Left side: A title skeleton line (`Skeleton className="h-4 w-32 max-w-[50%]"`) and a subtitle/description skeleton line (`Skeleton className="h-3 w-56 max-w-[80%]"`) with `space-y-1.5`.
     - Right side: A badge / status / action placeholder skeleton (`Skeleton className="h-3.5 w-20 shrink-0"` or button skeleton).
