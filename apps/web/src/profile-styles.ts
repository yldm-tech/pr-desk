// The account control in the header and the popover behind it. The loading
// skeleton stands in for the same shapes, so both draw on these rather than
// keeping two descriptions of one control in step by hand.
//
// The two width limits are written as non-overlapping ranges: one variant does
// not reliably override another, the generated stylesheet decides the order.
// The minimum height is left to the caller: the skeleton used to win it on
// specificity, which utilities of equal weight cannot reproduce.
export const accountTrigger =
  "flex max-w-[260px] items-center gap-[9px] rounded-[9px] border border-[var(--border)] bg-[var(--surface)] py-1 pr-[9px] pl-[5px] text-[length:var(--text-body)] font-normal text-[var(--foreground)] hover:border-[var(--accent-border)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)] [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [@media(max-width:640px)]:max-w-[150px] [@media(max-width:800px)_and_(min-width:641px)]:max-w-[180px] [@media(max-width:480px)]:py-[3px] [@media(max-width:480px)]:pr-[3px] [@media(max-width:480px)]:pl-[3px] [@media(max-width:480px)]:[&>span]:hidden [@media(max-width:480px)]:[&>svg]:hidden";

// Size is always given by the caller for the same reason the trigger height
// is: two width utilities in one attribute do not resolve by writing order.
export const accountAvatar = "shrink-0 rounded-[50%] object-cover";
export const accountAvatarFallback = `${accountAvatar} grid place-items-center bg-[var(--border)]`;

export const profilePopover =
  "z-30 box-border max-h-[var(--radix-popover-content-available-height)] w-[min(340px,calc(100vw-32px))] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 font-[family-name:var(--font-ui)] text-[length:var(--text-caption)] leading-[1.5] text-[var(--foreground)] shadow-[0_16px_48px_var(--shadow)] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-[3px] [&_a:focus-visible]:outline-[var(--accent)] [&_a:hover]:text-[var(--accent-text)] [&_a:hover]:underline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-[3px] [&_button:focus-visible]:outline-[var(--accent)]";

export const profileIdentity = "flex items-center gap-3 text-inherit no-underline [&_small]:mt-1 [&_small]:block [&_small]:text-[length:var(--text-caption)] [&_small]:leading-[1.5] [&_small]:text-[var(--muted)] [&_strong]:block [&_strong]:text-[18px] [&_strong]:[overflow-wrap:anywhere]";

export const profileBio = "mx-0 my-[18px] leading-[1.7] [overflow-wrap:anywhere]";

export const profileMetadata = "mx-0 my-4 text-[var(--muted)] [&_p]:mx-0 [&_p]:my-2.5 [&_p]:flex [&_p]:items-center [&_p]:gap-2 [&_p]:[overflow-wrap:anywhere] [&_svg]:shrink-0";

export const profileStats =
  "grid grid-cols-3 gap-2 border-y border-[var(--border)] py-3.5 [font-variant-numeric:tabular-nums] [&_a:hover]:bg-[var(--surface-muted)] [&_a:hover]:no-underline [&_a]:rounded-md [&_a]:py-[5px] [&_a]:text-center [&_a]:text-inherit [&_a]:no-underline [&_span]:mt-1.5 [&_span]:block [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)] [&_strong]:block [&_strong]:text-[18px]";
