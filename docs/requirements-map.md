# Requirements Map

Maps the simplified COLA workflow to fields, OCR targets, and product-specific
rules used by the deterministic verification engine.

## 1. Application Type (step 1)

| Field | Notes |
| --- | --- |
| `productType` | `wine \| domestic_sake \| distilled_spirits \| malt_beverage`. **Source of truth.** |
| `sourceOfProduct` | `domestic \| imported`. Drives `countryOfOrigin` enforcement. |
| `applicationType` | `certificate_of_label_approval \| certificate_of_exemption` |
| `stateOfSaleForExemption` | Required iff `applicationType = certificate_of_exemption` |
| `isResubmission` | boolean |
| `priorTtbId` | Required iff `isResubmission = true` |

## 2. COLA Information (step 2)

### Shared fields

`serialNumber, permits[], dbaTradeName, brandName, fancifulName, formulaId,
netContents[], alcoholContent, nameAndAddress, countryOfOrigin,
notesToSpecialist`.

`brandName` is required. `netContents` is an array (e.g., `750 mL`, `1.5 L`).

### Wine

`vintageYear, grapeVarietals[], appellation, containsSulfites,
sulfiteDeclarationExpected`.

Cross-field rule: if `vintageYear` is entered, `appellation` is required.

### Distilled Spirits

`distinctiveBottleApprovalRequested, totalBottleCapacityBeforeClosure,
ageStatement, stateOfDistillation`.

### Malt Beverage

`alcoholContentRequiredBecauseOfFlavorOrAddedIngredients,
containsFdCYellow5, containsAspartame, containsCochinealOrCarmine,
containsSulfites`.

### Domestic Sake

Uses shared fields in MVP. Wine-like optional fields (vintage, appellation,
grape varietals) are evaluated only if entered. Limitation documented.

## 3. Upload Labels (step 3)

| Field | Notes |
| --- | --- |
| `labelImages[]` | max 10, each with `fileName, mimeType, size, labelImageType, width?, height?` |
| `labelImageType` | `brand \| back \| neck \| side \| strip \| other \| unknown` |
| `foreignTextTranslation` | textarea |
| `specialWordingOrDesigns` | textarea |
| `embossedBlownBrandedContainerText` | textarea |
| `attachments[]` | optional supporting files |

## OCR target map

| Target | Applies to |
| --- | --- |
| brandName | all |
| dbaTradeName | all |
| fancifulName | all |
| classOrTypeDesignation | all |
| netContents | all |
| alcoholContent | all |
| nameAndAddress | all |
| countryOfOrigin | all (enforced when imported) |
| governmentWarning | all |
| foreignLanguageText | all |
| specialWordingOrDesigns | all |
| vintageYear | wine, domestic_sake (if entered) |
| grapeVarietals | wine, domestic_sake (if entered) |
| appellation | wine, domestic_sake (if entered) |
| sulfiteDeclaration | wine, malt_beverage (if expected) |
| proof | distilled_spirits |
| ageStatement | distilled_spirits |
| stateOfDistillation | distilled_spirits |
| neutralSpiritsStatement | distilled_spirits |
| coloringOrWoodTreatmentStatement | distilled_spirits |
| fdCYellow5Disclosure | malt_beverage |
| aspartameDisclosure | malt_beverage |
| cochinealOrCarmineDisclosure | malt_beverage |

## Verification check coverage

### Shared

- Brand name match
- DBA/trade name (if entered) match
- Fanciful name (if entered) match
- Class/type present
- Net contents match (any of the entered values)
- Alcohol content match (if entered/required)
- Name & address present/match
- Country of origin (if imported)
- Government warning present
- Government warning prefix uppercase
- Required warning wording present
- Image quality

### Wine

shared + vintage (if entered) + grape varietals (if entered) + appellation
(if entered) + appellation-required-when-vintage cross-check + sulfite
declaration (if expected).

### Distilled Spirits

shared + proof/ABV consistency + age statement (if entered) + state of
distillation (if entered) + same-field-of-vision (`human_review_required`
unless image position evidence is reliable).

### Malt Beverage

shared + ingredient disclosures (FD&C Yellow 5, aspartame, cochineal/carmine,
sulfites) when expected.

### Domestic Sake

shared + optional wine-like checks when fields were entered.

## Overall status decision

```
fail          ← any error-level missing/mismatch on a critical required field
needs_review  ← any warning, likely_match, image-quality issue, or
                human-review-required check
pass          ← all required checks match
```
