"""The house layout every v3 procedure section follows, shared by all families."""
from __future__ import annotations

from qa.v3_authoring.model import Block, Bullets, Callout, Paragraph, Rule, Rules, Section, Subheading, Text

WHEN = Text("متى تنطبق هذه الحالة", "When this applies")
RULES = Text("القواعد", "Rules")
EXAMPLE = Text("مثال من الميدان", "Example from the field")
MISTAKES = Text("أخطاء شائعة", "Common mistakes")


def procedure(title: Text, when: Text, rules: tuple[Rule, ...], example: Text, mistakes: tuple[Text, ...],
              extra: tuple[Block, ...]) -> Section:
    """One procedure section: when it applies, the numbered rules, optional tables or figures, an example from the
    field, and common mistakes. Only the rules are normative."""
    return Section(title=title, kind="section", procedure=True, blocks=(
        Subheading(WHEN), Paragraph(when),
        Subheading(RULES), Rules(rules),
        *extra,
        Callout(EXAMPLE, example),
        Subheading(MISTAKES), Bullets(mistakes),
    ))
