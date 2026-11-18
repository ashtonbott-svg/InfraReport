"use client";

import { ClipboardList } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { JobBoard } from "@/components/jobs/job-board";
import { ResumeInspections } from "@/components/field/resume-card";
import { SyncNotice } from "@/components/sync/sync-status";
import { useRole } from "@/lib/cloud/role";
import { useStore } from "@/lib/store/store";

/** Technician portal (and an administrator's field view): only jobs this person is assigned to. */
export default function JobsPage() {
  const { me } = useRole();
  const userId = useStore((s) => s.currentUserId);
  return (
    <>
      <PageHeader title="My Jobs" description={me ? `Signed in as ${me.name}${me.certification ? `, ${me.certification}` : ""}.` : undefined} />
      <SyncNotice />
      <ResumeInspections />
      <JobBoard onlyUserId={me?.userId ?? userId}
        empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No jobs assigned yet" description="When an administrator assigns you to an inspection it appears here. Pull to refresh or wait a few seconds while online." />} />
    </>
  );
}
