"use client";

import Link from "next/link";
import Badge from "@/components/ui/Badge";

interface Campaign {
  id: number;
  name: string;
  status: string;
  topics_json: string;
  frequency: string;
}

interface Props {
  campaign: Campaign;
}

export default function CampaignCard({ campaign }: Props) {
  let topics: string[] = [];
  try {
    topics = JSON.parse(campaign.topics_json);
  } catch {
    /* empty */
  }

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="group block rounded-xl border border-indigo-100/50 bg-white p-5 hover:border-violet-200 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-medium text-gray-900 truncate group-hover:text-violet-700">
          {campaign.name}
        </h3>
        <Badge status={campaign.status} />
      </div>

      <p className="text-xs text-gray-400 capitalize mb-3 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {campaign.frequency}
      </p>

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.slice(0, 3).map((t) => (
            <span
              key={t}
              className="rounded-md bg-gray-50 border border-gray-100 px-2 py-0.5 text-[11px] text-gray-500"
            >
              {t}
            </span>
          ))}
          {topics.length > 3 && (
            <span className="text-[11px] text-gray-300 self-center">+{topics.length - 3}</span>
          )}
        </div>
      )}
    </Link>
  );
}
