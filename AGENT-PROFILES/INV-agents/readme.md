Inv Process

Overview
The INV process starts when an image is dropped into the INV capture box. Auto generates a new inv-chat in the database and memory. Includes inv-chat uid, timestamp, saves: original image, completed text template, QBO-INV number (in any), related invs if any, any other meta data that can be brainstormed and suggested. Raw template data and clean edited template data. QBO, QBOp, QBOA, payments etc.

INV IMAGE PARSER (first step): creates new INV-chat record in the database, parses images of invs, returns a completed inv template in text, adds them to the new record with the default meta data. Returns the completed template to the user for a pass/fail check. It always must be 100% accuracy to the original raw image.

INV EDITOR (second step - parallel): reviews each field of the raw parsed INV template data and provides an edited clean final version based on clear guardrails for each field. Saves clean final to database. Returns the completed template to the user for a pass/fail check.

RELATED INV AGENT (second step - parallel): searches INV database for related invs, gives a weight to each related INV, reasons for the given weight/grade, whether it is open/closed, validity, links to the related invs page. Saves to the database.

INV RESEARCHER ( ): does deep research into additional troubleshooting steps, possible resolutions and fixes, whether the INV is valid. Does everything possible to fix the issue before the INV is officially submitted.
