import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { count } from 'drizzle-orm';
import { db } from './index.ts';
import {
  users,
  boardModels,
  batches,
  inspections,
  defects,
  aiInsights,
  knowledgeDocs,
} from './schema.ts';

interface DefectTemplate {
  defectType:
    | 'Missing Component'
    | 'Solder Bridge'
    | 'Misalignment'
    | 'Short Circuit'
    | 'Wrong Polarity';
  componentRef: string;
  severity: 'CRITICAL' | 'WARNING';
  posX: number;
  posY: number;
  rootCause: string;
  correctiveAction: string;
  confidence: number;
}

const DEFECT_CATALOG: DefectTemplate[] = [
  {
    defectType: 'Missing Component',
    componentRef: 'C9',
    severity: 'WARNING',
    posX: 20.5,
    posY: 26.8,
    rootCause: 'Pick-and-Place Feeder Jam',
    correctiveAction: 'Inspect 0402 tape feeder tension and vacuum nozzle tip on Station 2',
    confidence: 0.98,
  },
  {
    defectType: 'Solder Bridge',
    componentRef: 'IC102',
    severity: 'CRITICAL',
    posX: 57.2,
    posY: 42.5,
    rootCause: 'Excess Solder Paste Volume',
    correctiveAction: 'Clean stencil underside and reduce squeegee pressure by 8% on Line 3',
    confidence: 0.97,
  },
  {
    defectType: 'Missing Component',
    componentRef: 'R104',
    severity: 'CRITICAL',
    posX: 27.6,
    posY: 13.8,
    rootCause: 'Nozzle Vacuum Pressure Drop',
    correctiveAction: 'Replace pickup nozzle #4 and verify vacuum sensor calibration',
    confidence: 0.96,
  },
  {
    defectType: 'Solder Bridge',
    componentRef: 'IC101',
    severity: 'CRITICAL',
    posX: 48.6,
    posY: 69.2,
    rootCause: 'Stencil Aperture Misalignment',
    correctiveAction: 'Re-align fiducial camera offset (+0.04mm Y-axis) on printer',
    confidence: 0.95,
  },
  {
    defectType: 'Misalignment',
    componentRef: 'L2',
    severity: 'WARNING',
    posX: 83.4,
    posY: 43.2,
    rootCause: 'Reflow Conveyor Vibration',
    correctiveAction: 'Check Zone 3 rail guides and tighten conveyor chain tensioner',
    confidence: 0.94,
  },
  {
    defectType: 'Short Circuit',
    componentRef: 'R115',
    severity: 'CRITICAL',
    posX: 81.2,
    posY: 61.5,
    rootCause: 'Solder Paste Slump in Preheat',
    correctiveAction: 'Adjust reflow preheat ramp rate from 2.4°C/s to 1.8°C/s',
    confidence: 0.93,
  },
  {
    defectType: 'Wrong Polarity',
    componentRef: 'D4',
    severity: 'WARNING',
    posX: 77.6,
    posY: 36.1,
    rootCause: 'Feeder Reel Orientation Error',
    correctiveAction: 'Verify diode tape reel polarity orientation before splice sign-off',
    confidence: 0.99,
  },
  {
    defectType: 'Missing Component',
    componentRef: 'R118',
    severity: 'CRITICAL',
    posX: 15.8,
    posY: 59.4,
    rootCause: 'Pick-and-Place Feeder Jam',
    correctiveAction: 'Clear splice tape obstruction on Feeder Slot 14',
    confidence: 0.95,
  },
  {
    defectType: 'Misalignment',
    componentRef: 'C22',
    severity: 'WARNING',
    posX: 37.5,
    posY: 64.5,
    rootCause: 'Uneven Pad Wetting',
    correctiveAction: 'Check copper pad oxidation and verify nitrogen purge flow',
    confidence: 0.91,
  },
  {
    defectType: 'Solder Bridge',
    componentRef: 'J1-P8',
    severity: 'CRITICAL',
    posX: 41.8,
    posY: 89.2,
    rootCause: 'Excess Solder Paste Volume',
    correctiveAction: 'Reduce step-stencil thickness on J1 header pads from 150um to 120um',
    confidence: 0.96,
  },
];

async function ensureKnowledgeDocsSeeded(): Promise<void> {
  const [{ value: docCount }] = await db
    .select({ value: count() })
    .from(knowledgeDocs);

  if (docCount > 0) return;

  await db
    .insert(knowledgeDocs)
    .values([
      {
        slug: 'ipc-a-610-solder-bridge-stencil',
        title: 'IPC-A-610 Class 2/3: Fine-Pitch Solder Bridge & Stencil Paste Control',
        category: 'SMT Screen Printing & Reflow',
        defectType: 'Solder Bridge',
        componentPattern: 'IC101,IC102,J1-P8,QFN,SOP',
        content:
          'Bridging across adjacent fine-pitch IC leads (0.4mm-0.5mm pitch) and connector headers is classified as a Process Indicator / Defect under IPC-A-610 Section 5.2. Primary root causes include excess solder paste volume from worn squeegee blades, stencil underside solder smearing, or insufficient wet-cleaning frequency between panels.',
        sopActions:
          '1) Clean stencil underside using dry+vacuum wipe every 5 panels. 2) Reduce squeegee pressure by 6-10% and verify stencil snap-off (0.0mm contact). 3) Inspect aperture alignment (+0.04mm fiducial offset check) and place affected shift batch on HOLD_REVIEW if rate exceeds 10%.',
        tags: 'solder bridge,ic102,ic101,j1-p8,stencil,paste,squeegee,fine-pitch,shift b',
      },
      {
        slug: 'smt-missing-component-0402-feeder',
        title: 'SMT Pick-and-Place: 0402/0603 Missing Component & Vacuum Drop SOP',
        category: 'Pick-and-Place Head & Feeder',
        defectType: 'Missing Component',
        componentPattern: 'C9,R104,R118,0402,0603',
        content:
          'Missing passive chip components (0402 capacitors/resistors like C9, R104, R118) typically originate from tape-and-reel cover-tape peel tension jams, clogged pickup nozzles, or vacuum threshold drift (< -65 kPa) on high-speed placement heads.',
        sopActions:
          '1) Inspect tape feeder advance pawl and splice clip tension on affected slot. 2) Clean or swap vacuum nozzle tip #4 and check O-ring seal. 3) Re-teach component pick height (+0.05mm Z-offset) and run 5-board first-article AOI verification.',
        tags: 'missing component,c9,r104,r118,feeder jam,vacuum,nozzle,0402,pick and place',
      },
      {
        slug: 'reflow-misalignment-conveyor-vibration',
        title: 'Reflow Oven & Placement: Component Skew / Misalignment Remediation',
        category: 'Placement & Reflow Mechanical',
        defectType: 'Misalignment',
        componentPattern: 'L2,C22',
        content:
          'Lateral offset or tombstoning skew (>25% pad overhang per IPC-A-610) on inductors and larger ceramic capacitors (L2, C22) occurs when reflow rail conveyor vibration shakes boards while solder is liquidus, or when asymmetric copper pad thermal mass creates uneven wetting torque.',
        sopActions:
          '1) Tighten Zone 3 conveyor chain tensioner and inspect PCB edge-rail flatness. 2) Check nitrogen purge flow and verify symmetric pad wetting during peak 242°C soak. 3) Reduce conveyor entry speed jitter and inspect placement head theta-axis calibration.',
        tags: 'misalignment,l2,c22,conveyor,vibration,wetting,skew,reflow',
      },
      {
        slug: 'reflow-short-circuit-paste-slump',
        title: 'Thermal Profile: Solder Paste Slump & Short Circuit Prevention',
        category: 'Reflow Thermal Profile',
        defectType: 'Short Circuit',
        componentPattern: 'R115',
        content:
          'Short circuits beneath low-standoff chip resistors and power pads (R115) are commonly triggered by aggressive preheat ramp rates (> 2.2°C/s) causing flux outgassing and solder paste slump prior to wetting.',
        sopActions:
          '1) Adjust preheat ramp rate from 2.4°C/s down to 1.6-1.8°C/s and extend soak plateau (150-180°C) to 75 seconds. 2) Verify ambient line humidity (<55% RH) and solder paste floor life (<8 hours on stencil).',
        tags: 'short circuit,r115,slump,preheat,ramp,thermal profile,flux',
      },
      {
        slug: 'polarity-reel-splice-verification',
        title: 'Component Polarity & Tape Reel Splice Poka-Yoke Protocol',
        category: 'Material Setup & Feeder Verification',
        defectType: 'Wrong Polarity',
        componentPattern: 'D4',
        content:
          'Reversed diode/LED/tantalum orientation (D4) happens when an operator splices a replacement tape reel 180° backwards or loads an unverified feeder bank without barcode LCR polarity verification.',
        sopActions:
          '1) Halt line immediately and quarantine all boards since last reel splice timestamp. 2) Perform 2-person barcode + cathode mark verification on feeder reel. 3) Run optical polarity template check on AOI station before resuming batch.',
        tags: 'wrong polarity,d4,diode,reel,splice,orientation,quarantine',
      },
      {
        slug: 'aoi-false-call-vs-true-defect',
        title: 'AOI Lighting Calibration & False Call Triage Protocol',
        category: 'AOI Optical Inspection QA',
        defectType: 'ALL',
        componentPattern: '*',
        content:
          'High false-call rates (>15% of FAIL flags overturned by operators as FALSE_POSITIVE) indicate coaxial RGB lighting glare on shiny HASL/ENIG pads or tight fiducial ROI tolerances rather than genuine SMT line drift.',
        sopActions:
          '1) Compare operator FALSE_CALL ratio against CONFIRMED_FAIL in recent unit reviews. 2) If FALSE_CALL exceeds 20% for a component ref, adjust AOI oblique ring-light exposure and re-train golden board ROI library instead of halting SMT production.',
        tags: 'false call,false positive,aoi,lighting,calibration,operator review,roi',
      },
    ])
    .onConflictDoNothing();
}

export async function ensureSeeded(): Promise<void> {
  await ensureKnowledgeDocsSeeded();

  const [{ value: modelCount }] = await db
    .select({ value: count() })
    .from(boardModels);

  if (modelCount > 0) {
    return;
  }

  console.log('[Board Sight] Seeding baseline PostgreSQL inspection catalog...');

  const defaultPasswordHash = await bcrypt.hash('BoardSight2025!', 10);

  const [michael, elena, david] = await db
    .insert(users)
    .values([
      {
        name: 'Michael Johnson',
        email: 'michael.johnson@boardsight.io',
        passwordHash: defaultPasswordHash,
        role: 'Operator',
        avatarUrl: '/src/assets/images/avatar_michael_johnson_1795410466098.jpg',
      },
      {
        name: 'Elena Rostova',
        email: 'elena.rostova@boardsight.io',
        passwordHash: defaultPasswordHash,
        role: 'QA Engineer',
        avatarUrl: null,
      },
      {
        name: 'David Chen',
        email: 'david.chen@boardsight.io',
        passwordHash: defaultPasswordHash,
        role: 'Admin',
        avatarUrl: null,
      },
    ])
    .onConflictDoNothing()
    .returning();

  const [modelX12, modelR8] = await db
    .insert(boardModels)
    .values([
      {
        code: 'Model X12',
        displayName: 'SmartSensor-X v2.3',
        pcbImageUrl: '/src/assets/images/pcb_board_topdown_1795410465435.jpg',
        description:
          'Industrial IoT edge telemetry sensor board with PIC32MZ MCU and RF frontend.',
      },
      {
        code: 'Model R8',
        displayName: 'PowerDrive Ctrl v1.8',
        pcbImageUrl: '/src/assets/images/pcb_board_topdown_1795410465435.jpg',
        description:
          '3-phase brushless motor controller PCB with isolated gate drivers.',
      },
    ])
    .returning();

  const [batch1200, batch1201, batch1202, batch1305] = await db
    .insert(batches)
    .values([
      {
        batchCode: '1200',
        shift: 'A',
        line: '3',
        boardModelId: modelX12.id,
        shiftDate: '2025-05-15',
        totalInspected: 480,
        defectiveBoards: 52,
        status: 'ACTIVE',
      },
      {
        batchCode: '1201',
        shift: 'B',
        line: '3',
        boardModelId: modelX12.id,
        shiftDate: '2025-05-16',
        totalInspected: 360,
        defectiveBoards: 61,
        status: 'HOLD_REVIEW',
      },
      {
        batchCode: '1202',
        shift: 'C',
        line: '2',
        boardModelId: modelX12.id,
        shiftDate: '2025-05-17',
        totalInspected: 216,
        defectiveBoards: 19,
        status: 'ACTIVE',
      },
      {
        batchCode: '1305',
        shift: 'A',
        line: '1',
        boardModelId: modelR8.id,
        shiftDate: '2025-05-18',
        totalInspected: 320,
        defectiveBoards: 24,
        status: 'ACTIVE',
      },
    ])
    .returning();

  // Deterministic inspection rows matching exact defect counts:
  // Total Model X12 defective boards = 52 + 61 + 19 = 132 (out of 1056 inspected => 12.5%)
  // Total Model X12 defects = 238 => Avg 1.80 defects/board
  // Distribution across Model X12:
  //   Solder Bridge: 76
  //   Missing Component: 72 (C9 appears 12 times in Batch 1200 & most frequent overall)
  //   Misalignment: 42
  //   Wrong Polarity: 28
  //   Short Circuit: 20
  // Sum = 76 + 72 + 42 + 28 + 20 = 238 defects

  const operatorCycle = [
    { id: michael?.id ?? null, name: 'Michael Johnson' },
    { id: elena?.id ?? null, name: 'Elena Rostova' },
    { id: david?.id ?? null, name: 'David Chen' },
  ];

  interface InspectionSeedItem {
    serialNumber: string;
    boardModelId: number;
    batchId: number;
    operatorId: number | null;
    operatorName: string;
    status: 'PASS' | 'FAIL';
    stationId: string;
    source: string;
    inspectedAt: Date;
    defectList: DefectTemplate[];
  }

  const inspectionItems: InspectionSeedItem[] = [];

  // Build exact deterministic defect pool for Model X12 (238 defects across 132 FAIL boards)
  // Interleaved deterministically across batches so every batch has realistic defect mix:
  //   Solder Bridge: 76 (36x IC102, 24x IC101, 16x J1-P8)
  //   Missing Component: 72 (34x C9, 22x R104, 16x R118)
  //   Misalignment: 42 (24x L2, 18x C22)
  //   Wrong Polarity: 28 (28x D4)
  //   Short Circuit: 20 (20x R115)
  const weightedBuckets: { tpl: DefectTemplate; remaining: number }[] = [
    { tpl: DEFECT_CATALOG[0], remaining: 38 }, // Missing Component - C9 (top individual defect)
    { tpl: DEFECT_CATALOG[1], remaining: 30 }, // Solder Bridge - IC102
    { tpl: DEFECT_CATALOG[2], remaining: 18 }, // Missing Component - R104
    { tpl: DEFECT_CATALOG[3], remaining: 26 }, // Solder Bridge - IC101
    { tpl: DEFECT_CATALOG[4], remaining: 24 }, // Misalignment - L2
    { tpl: DEFECT_CATALOG[6], remaining: 28 }, // Wrong Polarity - D4
    { tpl: DEFECT_CATALOG[5], remaining: 20 }, // Short Circuit - R115
    { tpl: DEFECT_CATALOG[7], remaining: 16 }, // Missing Component - R118
    { tpl: DEFECT_CATALOG[8], remaining: 18 }, // Misalignment - C22
    { tpl: DEFECT_CATALOG[9], remaining: 20 }, // Solder Bridge - J1-P8
  ];

  const defectPool: DefectTemplate[] = [];
  while (defectPool.length < 238) {
    for (const bucket of weightedBuckets) {
      if (bucket.remaining > 0) {
        defectPool.push(bucket.tpl);
        bucket.remaining -= 1;
      }
    }
  }

  // Distribute 132 FAIL inspections across batches (52 in 1200, 61 in 1201, 19 in 1202)
  const batchPlan = [
    { batch: batch1200, failCount: 52, baseDate: '2025-05-15T08:00:00Z' },
    { batch: batch1201, failCount: 61, baseDate: '2025-05-16T14:00:00Z' },
    { batch: batch1202, failCount: 19, baseDate: '2025-05-17T10:00:00Z' },
  ];

  let poolIdx = 0;
  let snCounter = 45600;

  for (const plan of batchPlan) {
    for (let i = 0; i < plan.failCount; i++) {
      const isLatestHero = plan.batch.id === batch1200.id && i === plan.failCount - 1;
      let serial: string;
      if (isLatestHero) {
        serial = 'SSX-23-045812';
      } else {
        snCounter += 1;
        if (snCounter === 45812) snCounter += 1;
        serial = `SSX-23-0${snCounter}`;
      }

      const op = isLatestHero
        ? operatorCycle[0]
        : operatorCycle[(i + plan.batch.id) % operatorCycle.length];

      // Determine how many defects on this board (1 or 2) so total = 238 across 132 boards
      // 106 boards with 2 defects, 26 boards with 1 defect => 212 + 26 = 238
      const globalBoardIdx = inspectionItems.length;
      const numDefects = globalBoardIdx < 106 ? 2 : 1;

      const boardDefects: DefectTemplate[] = [];
      for (let d = 0; d < numDefects; d++) {
        boardDefects.push(defectPool[poolIdx % defectPool.length]);
        poolIdx += 1;
      }

      const inspectedDate = isLatestHero
        ? new Date('2025-05-17T14:26:00Z')
        : new Date(new Date(plan.baseDate).getTime() + i * 6 * 60 * 1000);

      inspectionItems.push({
        serialNumber: serial,
        boardModelId: modelX12.id,
        batchId: plan.batch.id,
        operatorId: op.id,
        operatorName: op.name,
        status: 'FAIL',
        stationId: `AOI-0${plan.batch.line}`,
        source: 'BASELINE',
        inspectedAt: inspectedDate,
        defectList: boardDefects,
      });
    }
  }

  // Also add 24 FAIL inspections for Model R8 (Batch 1305)
  for (let i = 0; i < 24; i++) {
    const op = operatorCycle[i % operatorCycle.length];
    const tpl = DEFECT_CATALOG[i % DEFECT_CATALOG.length];
    inspectionItems.push({
      serialNumber: `PDR-18-0921${String(i + 1).padStart(2, '0')}`,
      boardModelId: modelR8.id,
      batchId: batch1305.id,
      operatorId: op.id,
      operatorName: op.name,
      status: 'FAIL',
      stationId: 'AOI-01',
      source: 'BASELINE',
      inspectedAt: new Date(new Date('2025-05-18T09:00:00Z').getTime() + i * 11 * 60 * 1000),
      defectList: [tpl],
    });
  }

  // Insert inspections and defects in batches
  const insertedInspections = await db
    .insert(inspections)
    .values(
      inspectionItems.map((item) => ({
        serialNumber: item.serialNumber,
        boardModelId: item.boardModelId,
        batchId: item.batchId,
        operatorId: item.operatorId,
        operatorName: item.operatorName,
        status: item.status,
        stationId: item.stationId,
        source: item.source,
        inspectedAt: item.inspectedAt,
      }))
    )
    .returning();

  const defectRows: {
    inspectionId: number;
    defectType: string;
    componentRef: string;
    severity: string;
    posX: number;
    posY: number;
    rootCause: string;
    correctiveAction: string;
    confidence: number;
    detectedAt: Date;
  }[] = [];

  insertedInspections.forEach((insp, idx) => {
    const item = inspectionItems[idx];
    for (const def of item.defectList) {
      defectRows.push({
        inspectionId: insp.id,
        defectType: def.defectType,
        componentRef: def.componentRef,
        severity: def.severity,
        posX: def.posX,
        posY: def.posY,
        rootCause: def.rootCause,
        correctiveAction: def.correctiveAction,
        confidence: def.confidence,
        detectedAt: item.inspectedAt,
      });
    }
  });

  // Chunk defect inserts to keep PostgreSQL parameterized query size clean
  for (let i = 0; i < defectRows.length; i += 100) {
    await db.insert(defects).values(defectRows.slice(i, i + 100));
  }

  await db.insert(aiInsights).values([
    {
      boardModelId: modelX12.id,
      batchId: batch1201.id,
      headline:
        "If the 'Solder Bridge' trend does not change, forecast: +23% by 05.25.2025",
      recommendation: 'Re-checking Batch 1201',
      targetBatchCode: '1201',
      forecastDelta: '+23%',
      analysisDetail:
        'Solder Bridge defects across fine-pitch pins on IC102 and IC101 accelerated by 18.4% during Shift B (16 May) on Line 3. Stencil underside wipe interval and paste viscosity drift correlate with the spike. Re-inspecting Batch 1201 and adjusting squeegee pressure by -8% is projected to bring defect rate below 6.5%.',
    },
    {
      boardModelId: modelR8.id,
      batchId: batch1305.id,
      headline:
        "Missing Component occurrences on R104 remain stable within nominal tolerance (-4% vs prior shift)",
      recommendation: 'Verify Feeder Slot 14 on Line 1',
      targetBatchCode: '1305',
      forecastDelta: '-4%',
      analysisDetail:
        'PowerDrive Ctrl v1.8 Batch 1305 maintains a 7.5% defect rate with isolated vacuum pickup warnings on Feeder Slot 14.',
    },
  ]);

  console.log('[Board Sight] Baseline PostgreSQL data seeded successfully.');
}

// Allow running directly via `npx tsx src/db/seed.ts`
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('seed.ts')
) {
  ensureSeeded()
    .then(() => {
      console.log('Seed complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
