const COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-indigo-50 text-indigo-700",
  archived: "bg-rose-50 text-rose-600",
  running: "bg-indigo-50 text-indigo-700",
  failed: "bg-rose-50 text-rose-700",
  degraded: "bg-amber-50 text-amber-700",
  pending_review: "bg-sky-50 text-sky-700",
  approved: "bg-amber-50 text-amber-700",
  queued: "bg-violet-50 text-violet-700",
  published: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  publish_failed: "bg-rose-100 text-rose-800",
};

interface Props {
  status: string;
  className?: string;
}

export default function Badge({ status, className = "" }: Props) {
  const color = COLORS[status] || "bg-gray-100 text-gray-600";
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${color} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
        status === "active" ? "bg-emerald-500" :
        status === "running" ? "bg-indigo-500" :
        status === "paused" || status === "approved" ? "bg-amber-500" :
        status === "failed" || status === "rejected" || status === "publish_failed" ? "bg-rose-500" :
        "bg-current opacity-40"
      }`} />
      {label}
    </span>
  );
}
