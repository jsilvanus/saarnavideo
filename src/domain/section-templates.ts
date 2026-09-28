import { evenRangeSlice, type Section } from "@/domain/sections";

export type SectionTemplate = {
  key: string;
  label: string;
  sections: string[];
};

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    key: "normal-mass",
    label: "Normal Mass",
    sections: [
      "Entrance",
      "Opening",
      "Psalm",
      "Gospel",
      "Sermon",
      "Creed",
      "Prayers",
      "Offering",
      "Eucharistic Prayer",
      "Communion",
      "Blessing",
      "Closing",
    ],
  },
  {
    key: "sermon",
    label: "Sermon",
    sections: ["Introduction", "Bible Study", "Our Life", "Future", "Conclusion"],
  },
];

export function findSectionTemplate(key: string) {
  return SECTION_TEMPLATES.find(template => template.key === key);
}

export function instantiateSectionTemplate(
  template: SectionTemplate,
  scope: Section["scope"],
  options: { sourceId?: string; startSeconds?: number; endSeconds?: number } = {},
): Section[] {
  return template.sections.map((label, index) => ({
    id: crypto.randomUUID(),
    label,
    scope,
    sourceId: options.sourceId,
    ...evenRangeSlice(index, template.sections.length, options),
    origin: "TEMPLATE",
  }));
}
