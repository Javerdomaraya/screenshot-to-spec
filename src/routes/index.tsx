import { createFileRoute } from "@tanstack/react-router";
import { EClassRoot } from "@/app/EClassApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "E-CLASS — Smart Schedule Generator" },
      {
        name: "description",
        content:
          "Plan school schedules, review teacher workloads, and prepare printable school programs.",
      },
      { property: "og:title", content: "E-CLASS — Smart Schedule Generator" },
      {
        property: "og:description",
        content: "A smart, local-first school schedule generator for Philippine schools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EClassRoot,
});
