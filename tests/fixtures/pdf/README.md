# PDF adapter fixtures

The deterministic fixture builder generates a minimal three-page PDF:
- 612 × 792 point portrait page with 0° rotation and Helvetica.
- 360 × 540 point page with 90° rotation and Times-Roman.
- 595 × 842 point page with 270° rotation and Courier.

The resources use standard PDF Base-14 Type 1 fonts so the fixture remains small and redistributable without embedding font binaries. It exercises font resource selection, mixed dimensions, and rotations; it does not claim coverage of embedded subset fonts. A malformed PDF with a valid header but no valid object/xref structure exercises the error mapping path.

A broader licensed corpus for embedded fonts, ligatures, CJK, RTL, multi-column text, XFA, and performance belongs in the dedicated PDF corpus/performance acceptance work.
