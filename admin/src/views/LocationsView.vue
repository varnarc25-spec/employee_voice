<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api";

interface StateRow {
  lgdCode: number;
  nameEn: string;
  nameLocal: string;
  kind: string;
  census2001Code: string | null;
  census2011Code: string | null;
  districtCount: number;
}
interface DistrictRow {
  lgdCode: number;
  nameEn: string;
  nameLocal: string | null;
  shortName: string | null;
  pesaStatus: string | null;
  subDistrictCount: number;
}
interface SubDistrictRow {
  lgdCode: number;
  nameEn: string;
  villageCount: number;
}
interface VillagePage {
  total: number;
  limit: number;
  offset: number;
  items: { lgdCode: number; nameEn: string }[];
}

const states = ref<StateRow[]>([]);
const districts = ref<DistrictRow[]>([]);
const subDistricts = ref<SubDistrictRow[]>([]);
const villages = ref<VillagePage>({ total: 0, limit: 50, offset: 0, items: [] });
const stateCode = ref("");
const districtCode = ref("");
const subDistrictCode = ref("");
const search = ref("");
const appliedSearch = ref("");
const error = ref("");
const loading = ref(false);
const selectedVillage = ref("");
const election = ref<VillageElection | null>(null);

interface ElectionNominee {
  name: string;
  party: string | null;
  votes: number | null;
}

interface VillageElection {
  matched: boolean;
  message: string;
  election: string | null;
  constituencyName: string | null;
  winner: string | null;
  party: string | null;
  nominees: ElectionNominee[];
}

const page = computed(() => Math.floor(villages.value.offset / villages.value.limit) + 1);
const pages = computed(() => Math.max(1, Math.ceil(villages.value.total / villages.value.limit)));

onMounted(async () => {
  loading.value = true;
  try {
    states.value = await api<StateRow[]>("/api/v1/admin/locations/states");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load states.";
  } finally {
    loading.value = false;
  }
});

watch(stateCode, async (code) => {
  districtCode.value = "";
  districts.value = [];
  if (!code) return;
  await loadDistricts(code);
});

watch(districtCode, async (code) => {
  subDistrictCode.value = "";
  subDistricts.value = [];
  if (!code) return;
  await loadSubDistricts(code);
});

watch(subDistrictCode, async () => {
  appliedSearch.value = "";
  search.value = "";
  selectedVillage.value = "";
  election.value = null;
  await loadVillages(0);
});

async function loadDistricts(code: string): Promise<void> {
  error.value = "";
  loading.value = true;
  try {
    districts.value = await api<DistrictRow[]>(`/api/v1/admin/locations/districts?stateCode=${code}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load districts.";
  } finally {
    loading.value = false;
  }
}

async function loadSubDistricts(code: string): Promise<void> {
  error.value = "";
  loading.value = true;
  try {
    subDistricts.value = await api<SubDistrictRow[]>(`/api/v1/admin/locations/sub-districts?districtCode=${code}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load sub-districts.";
  } finally {
    loading.value = false;
  }
}

async function loadVillages(offset: number): Promise<void> {
  if (!subDistrictCode.value) {
    villages.value = { total: 0, limit: 50, offset: 0, items: [] };
    return;
  }
  error.value = "";
  loading.value = true;
  try {
    const query = new URLSearchParams({
      subDistrictCode: subDistrictCode.value,
      offset: String(offset),
      limit: "50",
    });
    if (appliedSearch.value) query.set("q", appliedSearch.value);
    villages.value = await api<VillagePage>(`/api/v1/admin/locations/villages?${query.toString()}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load villages.";
  } finally {
    loading.value = false;
  }
}

function applySearch(): void {
  appliedSearch.value = search.value.trim();
  void loadVillages(0);
}

function voteLabel(votes: number | null): string {
  if (votes == null) return "";
  return ` · ${votes.toLocaleString("en-IN")} votes`;
}

async function showElection(village: { lgdCode: number; nameEn: string }): Promise<void> {
  selectedVillage.value = village.nameEn;
  election.value = {
    matched: false,
    message: "Looking up the latest election…",
    election: null,
    constituencyName: null,
    winner: null,
    party: null,
    nominees: [],
  };
  try {
    election.value = await api<VillageElection>(`/api/v1/locations/villages/${village.lgdCode}/election`);
  } catch (caught) {
    election.value = {
      matched: false,
      message: caught instanceof Error ? caught.message : "Could not load the election result.",
      election: null,
      constituencyName: null,
      winner: null,
      party: null,
      nominees: [],
    };
  }
}
</script>

<template>
  <section>
    <h1>Locations</h1>
    <p class="banner">States, districts, sub-districts, and villages from the Local Government Directory, with their LGD codes.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="filters">
      <label>
        State
        <select v-model="stateCode">
          <option value="">All states ({{ states.length }})</option>
          <option v-for="state in states" :key="state.lgdCode" :value="String(state.lgdCode)">{{ state.nameEn }}</option>
        </select>
      </label>
      <label>
        District
        <select v-model="districtCode" :disabled="!stateCode">
          <option value="">All districts ({{ districts.length }})</option>
          <option v-for="district in districts" :key="district.lgdCode" :value="String(district.lgdCode)">{{ district.nameEn }}</option>
        </select>
      </label>
      <label>
        Sub-district
        <select v-model="subDistrictCode" :disabled="!districtCode">
          <option value="">All sub-districts ({{ subDistricts.length }})</option>
          <option v-for="sub in subDistricts" :key="sub.lgdCode" :value="String(sub.lgdCode)">{{ sub.nameEn }}</option>
        </select>
      </label>
    </div>

    <form v-if="subDistrictCode" class="filters" @submit.prevent="applySearch">
      <label>
        Search villages
        <input v-model="search" type="search" placeholder="Village name" />
      </label>
      <button type="submit">Search</button>
    </form>

    <p v-if="loading">Loading…</p>

    <template v-else-if="subDistrictCode">
      <div v-if="election" class="banner">
        <p v-if="!election.matched">{{ selectedVillage }}: {{ election.message }}</p>
        <template v-else>
          <p>{{ selectedVillage }}: {{ election.election }} · {{ election.constituencyName }} · Won by {{ election.winner }}<template v-if="election.party"> ({{ election.party }})</template></p>
          <p v-if="election.nominees.length === 0">Nominee names are not stored for this election.</p>
          <template v-else>
            <p>Nominated</p>
            <ul class="nominees">
              <li v-for="person in election.nominees" :key="person.name">{{ person.name }}<template v-if="person.party"> ({{ person.party }})</template>{{ voteLabel(person.votes) }}</li>
            </ul>
          </template>
        </template>
      </div>
      <table>
        <thead>
          <tr><th>LGD code</th><th>Village</th></tr>
        </thead>
        <tbody>
          <tr v-for="village in villages.items" :key="village.lgdCode">
          <td>{{ village.lgdCode }}</td>
          <td><button class="signout" type="button" @click="showElection(village)">{{ village.nameEn }}</button></td>
          </tr>
          <tr v-if="villages.items.length === 0"><td colspan="2">No villages match.</td></tr>
        </tbody>
      </table>
      <div class="pager">
        <button class="secondary" type="button" :disabled="villages.offset === 0" @click="loadVillages(Math.max(0, villages.offset - villages.limit))">Previous</button>
        <span>Page {{ page }} of {{ pages }} · {{ villages.total }} villages</span>
        <button class="secondary" type="button" :disabled="villages.offset + villages.limit >= villages.total" @click="loadVillages(villages.offset + villages.limit)">Next</button>
      </div>
    </template>

    <table v-else-if="districtCode">
      <thead>
        <tr><th>LGD code</th><th>Sub-district</th><th>Villages</th></tr>
      </thead>
      <tbody>
        <tr v-for="sub in subDistricts" :key="sub.lgdCode">
          <td>{{ sub.lgdCode }}</td>
          <td><button class="signout" type="button" @click="subDistrictCode = String(sub.lgdCode)">{{ sub.nameEn }}</button></td>
          <td>{{ sub.villageCount }}</td>
        </tr>
        <tr v-if="subDistricts.length === 0"><td colspan="3">No sub-districts for this district.</td></tr>
      </tbody>
    </table>

    <table v-else-if="stateCode">
      <thead>
        <tr><th>LGD code</th><th>District</th><th>Local name</th><th>PESA</th><th>Sub-districts</th></tr>
      </thead>
      <tbody>
        <tr v-for="district in districts" :key="district.lgdCode">
          <td>{{ district.lgdCode }}</td>
          <td><button class="signout" type="button" @click="districtCode = String(district.lgdCode)">{{ district.nameEn }}</button></td>
          <td>{{ district.nameLocal }}</td>
          <td>{{ district.pesaStatus }}</td>
          <td>{{ district.subDistrictCount }}</td>
        </tr>
        <tr v-if="districts.length === 0"><td colspan="5">No districts for this state.</td></tr>
      </tbody>
    </table>

    <table v-else>
      <thead>
        <tr><th>LGD code</th><th>State</th><th>Local name</th><th>Type</th><th>Census 2011</th><th>Districts</th></tr>
      </thead>
      <tbody>
        <tr v-for="state in states" :key="state.lgdCode">
          <td>{{ state.lgdCode }}</td>
          <td><button class="signout" type="button" @click="stateCode = String(state.lgdCode)">{{ state.nameEn }}</button></td>
          <td>{{ state.nameLocal }}</td>
          <td>{{ state.kind }}</td>
          <td>{{ state.census2011Code }}</td>
          <td>{{ state.districtCount }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
