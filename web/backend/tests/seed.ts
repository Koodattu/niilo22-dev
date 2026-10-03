import { configureTestDatabase, createFixture } from "./support.js";
configureTestDatabase();
const fixture = await createFixture();
try { console.log((await fixture.import()).stdout); } finally { await fixture.cleanup(); }
