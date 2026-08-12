# Space Programs and Interior Constraints

## Purpose

The zoning engine creates accessible unit boundaries. A space program defines
what belongs inside a unit and checks whether a manual or generated interior
can be used in practice. This separates use-type knowledge from geometry.

The first program, `residential`, includes entrance, living room, kitchen,
bathroom, bedroom and storage rules. The data model supports future programs
such as Korean restaurants, Japanese restaurants and offices without changing
the evaluator.

## Constraint types

Hard constraints reject a result: required room missing, room area below its
minimum, room area above its maximum, insufficient room width, or a required
connection missing. Soft constraints create warnings and lower the score:
recommended area ratio, preferred adjacency and direct-visibility concerns.

For example, an entrance has an explicit maximum area. A large dwelling does
not turn unused area into an implausibly large entrance; expansion is assigned
to spaces such as living rooms, bedrooms and storage according to the program
expansion order.

## API

`GET /api/space-programs` lists program definitions.

`POST /api/space-programs/{program_id}/evaluate` accepts a total area, a list
of spaces (`kind`, `area`, optional `width`) and an adjacency list. It returns
an area schedule, explainable checks and a score. It is deliberately
geometry-independent so both the existing canvas editor and a later automatic
interior generator can reuse it.

```json
{
  "total_area": 160,
  "spaces": [
    {"kind": "entrance", "area": 4, "width": 1.4},
    {"kind": "living", "area": 38, "width": 5},
    {"kind": "kitchen", "area": 20, "width": 3},
    {"kind": "bathroom", "area": 6, "width": 2},
    {"kind": "bedroom", "area": 16, "width": 3}
  ],
  "adjacencies": [
    {"source": "entrance", "target": "living"},
    {"source": "living", "target": "kitchen"}
  ]
}
```

## Next implementation steps

1. Add `korean_restaurant`, `japanese_restaurant` and `office` definitions.
2. Connect the canvas room graph to the evaluation endpoint.
3. Add `interior_generator.py` to allocate room rectangles inside each unit,
   discard hard-constraint failures, and rank 3 alternatives using soft scores.
4. Add a program report panel: area composition, flow distances, warnings and
   comparison against recommended proportions.
