// The account control in the header and the popover behind it. The loading
// skeleton stands in for the same shapes, so both draw on these rather than
// keeping two descriptions of one control in step by hand.
//
// The width limits are mobile-first and measure @container/dashboard, not the
// window: the trigger renders inside <main>, whose content box is not a
// function of the viewport alone — the same 1024px window leaves it 765px or
// 647px depending on whether the sidebar has appeared. Each limit is one edge
// rather than a pair of bounds, so no two of them can overlap and the
// stylesheet order stops mattering.
//
// The chevron stays at every width. It costs 13px and it is the only cue that
// this control opens a menu rather than linking to a GitHub profile, which
// matters most on the phone where the name beside it is already hidden.
//
// The minimum height is still left to the caller — the skeleton used to win it
// on specificity, which utilities of equal weight cannot reproduce — but the
// coarse-pointer floor is not, because a caller that forgets it leaves a 38px
// target on the only route to Disconnect.
export const accountTrigger =
  "flex max-w-[150px] items-center gap-[9px] rounded-[9px] border border-[var(--border)] bg-[var(--surface)] py-1 pr-[9px] pl-[5px] text-[length:var(--text-body)] font-normal text-[var(--foreground)] hover:border-[var(--accent-border)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)] [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap @row/dashboard:max-w-[180px] @table/dashboard:max-w-[260px] @max-split/dashboard:p-1.5 @max-split/dashboard:[&>span]:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11";

// Size is always given by the caller for the same reason the trigger height
// is: two width utilities in one attribute do not resolve by writing order.
export const accountAvatar = "shrink-0 rounded-[50%] object-cover";
export const accountAvatarFallback = `${accountAvatar} grid place-items-center bg-[var(--border)]`;

// A `:hover` written inside an arbitrary selector is not wrapped in (hover:
// hover) the way the `hover:` variant is, so on a touch screen it latches onto
// whatever was tapped last and stays there. The `hoverable:` prefix supplies
// the guard the variant would have given for free.
export const profilePopover =
  "z-30 box-border max-h-[var(--radix-popover-content-available-height)] w-[min(340px,calc(100vw-32px))] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 font-[family-name:var(--font-ui)] text-[length:var(--text-caption)] leading-[1.5] text-[var(--foreground)] shadow-[0_16px_48px_var(--shadow)] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-[3px] [&_a:focus-visible]:outline-[var(--accent)] hoverable:[&_a:hover]:text-[var(--accent-text)] hoverable:[&_a:hover]:underline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-[3px] [&_button:focus-visible]:outline-[var(--accent)]";

export const profileIdentity = "flex items-center gap-3 text-inherit no-underline [&_small]:mt-1 [&_small]:block [&_small]:text-[length:var(--text-caption)] [&_small]:leading-[1.5] [&_small]:text-[var(--muted)] [&_strong]:block [&_strong]:text-[length:1.125rem] [&_strong]:[overflow-wrap:anywhere]";

export const profileBio = "mx-0 my-[18px] leading-[1.7] [overflow-wrap:anywhere]";

export const profileMetadata = "mx-0 my-4 text-[var(--muted)] [&_p]:mx-0 [&_p]:my-2.5 [&_p]:flex [&_p]:items-center [&_p]:gap-2 [&_p]:[overflow-wrap:anywhere] [&_svg]:shrink-0";

export const profileStats =
  "grid grid-cols-3 gap-2 border-y border-[var(--border)] py-3.5 [font-variant-numeric:tabular-nums] hoverable:[&_a:hover]:bg-[var(--surface-muted)] hoverable:[&_a:hover]:no-underline [&_a]:rounded-md [&_a]:py-[5px] [&_a]:text-center [&_a]:text-inherit [&_a]:no-underline [&_span]:mt-1.5 [&_span]:block [&_span]:text-[length:var(--text-caption)] [&_span]:leading-[1.5] [&_span]:text-[var(--muted)] [&_strong]:block [&_strong]:text-[length:1.125rem]";
