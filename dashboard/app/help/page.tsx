"use client";

import { BookOpen, LifeBuoy, Shield, Terminal } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";

const SUPPORT_EMAIL = "support@vguardrail.example.com";

export default function HelpPage(): JSX.Element {
  return (
    <DashboardLayout>
      <PageHeader
        title="Help & Support"
        description="Getting started guides, troubleshooting tips, and how to reach the VGuardrail team."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="md">
          <CardHeader
            title="Getting started"
            description="Bring a new device under policy in two steps."
            action={
              <BookOpen
                className="h-5 w-5 text-gray-400 dark:text-gray-500"
                aria-hidden="true"
              />
            }
          />
          <ol className="list-decimal list-inside space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <li>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                Enroll a device.
              </span>{" "}
              Install the VGuardrail agent on the machine and enroll it with
              your organization&apos;s enrollment token (Settings →
              Enrollment). The device appears on the Devices page once it
              checks in.
            </li>
            <li>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                Install connectors.
              </span>{" "}
              Add the browser extension, IDE plugin, or CLI connector for the
              AI tools your team uses. Connectors report their version per
              device, so the Devices page shows exactly what is deployed
              where.
            </li>
          </ol>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Agent troubleshooting"
            description="When a device stops reporting or decisions look wrong."
            action={
              <Terminal
                className="h-5 w-5 text-gray-400 dark:text-gray-500"
                aria-hidden="true"
              />
            }
          />
          <ul className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <li>
              Run{" "}
              <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5">
                swift run vgselfcheck
              </code>{" "}
              on the device to verify the agent build, policy engine
              connection, and event pipeline end to end.
            </li>
            <li>
              Run{" "}
              <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5">
                vguardiand --inventory-once
              </code>{" "}
              to force a one-off process and browser-extension inventory
              snapshot and confirm the daemon can reach the backend.
            </li>
            <li>
              If decisions show as &quot;policy engine unavailable&quot;, the
              local engine daemon is down — it is supervised and should
              restart; persistent failures are worth a support ticket.
            </li>
          </ul>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Policies & exceptions"
            description="How warn and block decisions map to severity tiers."
            action={
              <Shield
                className="h-5 w-5 text-gray-400 dark:text-gray-500"
                aria-hidden="true"
              />
            }
          />
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p>
              Every scanned prompt receives a decision:{" "}
              <span className="font-medium text-gray-900 dark:text-gray-100">
                warn
              </span>{" "}
              lets the request through with a notice to the user, while{" "}
              <span className="font-medium text-gray-900 dark:text-gray-100">
                block
              </span>{" "}
              stops it before any data leaves the device.
            </p>
            <ul className="space-y-2">
              <li>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  Low
                </span>{" "}
                — a notice is shown; the request proceeds.
              </li>
              <li>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  Medium
                </span>{" "}
                — an alert is raised for review; the request proceeds.
              </li>
              <li>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  High / Critical
                </span>{" "}
                — the request is blocked with no user override.
              </li>
            </ul>
            <p>
              Approved exceptions can relax a specific rule for a limited time
              — request one from the Exceptions page with the rule ID and a
              business justification.
            </p>
          </div>
        </Card>

        <Card padding="md">
          <CardHeader
            title="Contact support"
            description="Stuck on something not covered here?"
            action={
              <LifeBuoy
                className="h-5 w-5 text-gray-400 dark:text-gray-500"
                aria-hidden="true"
              />
            }
          />
          <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <p>
              Email the VGuardrail team with your organization name, the
              affected device ID (if any), and what you expected to happen.
            </p>
            <p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-vg-primary-600 hover:underline font-medium"
              >
                {SUPPORT_EMAIL}
              </a>
            </p>
            <p className="text-gray-500 dark:text-gray-400">
              Include the output of the self-check commands above for the
              fastest turnaround on agent issues.
            </p>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
