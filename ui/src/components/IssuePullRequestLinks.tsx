import type { IssueWorkProduct } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import { pullRequestHref, pullRequestLabel, pullRequestNeedsReview, pullRequestState } from "@/lib/issue-pull-requests";

/** Saved PRs remain inspectable even when the provider lookup is unavailable. */
export function IssuePullRequestLinks({ products }: { products: IssueWorkProduct[] }) {
  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {products.map((product) => {
        const href = pullRequestHref(product);
        const label = pullRequestLabel(product);
        const state = pullRequestState(product);
        return (
          <li key={product.id} className="flex min-w-0 flex-wrap items-center gap-2">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" title={product.title}
                className="break-words text-sm text-primary underline-offset-2 hover:underline">
                {label}
              </a>
            ) : <span className="break-words text-sm">{label} · No PR link provided</span>}
            {pullRequestNeedsReview(product) ? (
              <Badge variant="outline">Review requested</Badge>
            ) : ["merged", "closed", "draft", "changes_requested"].includes(state) ? (
              <span className="text-xs text-muted-foreground">{state.replaceAll("_", " ")}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
