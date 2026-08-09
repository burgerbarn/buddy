"""
title: Home Assistant
description: Query and control Home Assistant devices (lights, switches, climate, sensors, etc.)
version: 1.4.0
"""

import requests
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        ha_url: str = Field(
            default="http://homeassistant:8123",
            description="Base URL of your Home Assistant instance.",
        )
        ha_token: str = Field(
            default="",
            description="Home Assistant Long-Lived Access Token (Profile -> Security -> Long-Lived Access Tokens in Home Assistant).",
        )

    def __init__(self):
        self.valves = self.Valves()

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.valves.ha_token}",
            "Content-Type": "application/json",
        }

    def _all_states(self):
        resp = requests.get(
            f"{self.valves.ha_url}/api/states", headers=self._headers(), timeout=10
        )
        resp.raise_for_status()
        return resp.json()

    _DOMAIN_WORDS = {
        "light": "light", "lights": "light",
        "switch": "switch", "switches": "switch", "outlet": "switch", "plug": "switch",
        "lock": "lock", "locks": "lock",
        "fan": "fan", "fans": "fan",
        "cover": "cover", "covers": "cover", "blind": "cover", "blinds": "cover",
        "shade": "cover", "shades": "cover", "garage": "cover",
    }

    def _find_entities(self, name: str, domain: str = ""):
        """
        Fuzzy-match a friendly name (or entity_id) against all known entities.
        Returns a list of matches — may be more than one, e.g. "family room lights"
        legitimately matches every light entity in that area (there's no single
        combined "group" entity for it), and callers should act on all of them.
        """
        states = self._all_states()

        name_l = name.strip().lower()
        words = name_l.split()
        if not domain and words and words[-1] in self._DOMAIN_WORDS:
            domain = self._DOMAIN_WORDS[words[-1]]
            stripped = " ".join(words[:-1]).strip()
            if stripped:
                name_l = stripped

        if domain:
            states = [s for s in states if s["entity_id"].startswith(f"{domain}.")]

        # Exact entity_id match wins outright.
        for s in states:
            if s["entity_id"].lower() == name_l:
                return [s]

        exact = []
        partial = []
        for s in states:
            friendly = str(s.get("attributes", {}).get("friendly_name", "")).lower()
            object_id = s["entity_id"].split(".", 1)[-1].replace("_", " ").lower()
            if name_l == friendly or name_l == object_id:
                exact.append(s)
            elif name_l and (
                name_l in friendly
                or friendly in name_l
                or name_l in object_id
                or object_id in name_l
            ):
                partial.append(s)

        return exact or partial

    def control_device_by_name(
        self,
        name: str,
        action: str = "",
        domain: str = "",
        brightness_pct: int = None,
        color: str = "",
        effect: str = "",
    ) -> str:
        """
        Control device(s) using an everyday name, e.g. "turn on the living room light",
        "lock the front door", "turn off the family room lights", "set the office
        light to 50% brightness", "make the den lights red", or "set the office
        light's effect to colorloop".
        This looks up the matching entity/entities for you — you do NOT need to know
        the internal entity_id, just describe the device(s) naturally. If the name
        matches several entities of the same kind (e.g. all lights in a room — there
        is no single combined "group" entity for a room), this acts on all of them at
        once. Use this instead of call_service whenever the user refers to a device by
        name. For media players (speakers, TVs) use control_media_player instead.

        :param name: The device's everyday/friendly name as the user said it, e.g. "living room light", "front door", "family room lights". Partial names are fine.
        :param action: What to do: "on", "off", or "toggle". For locks use "lock"/"unlock". For covers use "open"/"close". Leave empty if you're only setting brightness/color/effect on a light (it will be turned on automatically).
        :param domain: Optional hint to narrow the search if the name is ambiguous, e.g. "light", "switch", "lock", "cover", "fan".
        :param brightness_pct: Optional, lights only: brightness from 0-100.
        :param color: Optional, lights only: a plain color name, e.g. "red", "warm white", "blue".
        :param effect: Optional, lights only: an effect name if the light supports one, e.g. "colorloop", "flame", "pulse", "morph".
        """
        if not self.valves.ha_token:
            return "Error: Home Assistant token is not configured. Set it in this tool's Valves settings."
        try:
            matches = self._find_entities(name, domain)
        except Exception as e:
            return f"Error reaching Home Assistant: {e}"

        if not matches:
            return f"No device found matching '{name}'."

        domains_present = {m["entity_id"].split(".", 1)[0] for m in matches}
        if len(domains_present) > 1:
            names = ", ".join(
                f"{m.get('attributes', {}).get('friendly_name', m['entity_id'])} ({m['entity_id'].split('.', 1)[0]})"
                for m in matches[:10]
            )
            return (
                f"'{name}' matches devices of different types, so I'm not sure what to do. "
                f"Did you mean one of: {names}? Add a domain hint (e.g. \"light\") to narrow it down."
            )

        entity_domain = domains_present.pop()
        entity_ids = [m["entity_id"] for m in matches]
        has_light_attrs = brightness_pct is not None or color or effect

        action_l = action.strip().lower()
        service_map = {
            "lock": {"on": "lock", "lock": "lock", "off": "unlock", "unlock": "unlock"},
            "cover": {"on": "open_cover", "open": "open_cover", "off": "close_cover", "close": "close_cover"},
        }
        if entity_domain == "light" and has_light_attrs and not action_l:
            service = "turn_on"
        else:
            service = service_map.get(entity_domain, {}).get(action_l)
            if not service:
                service = {"on": "turn_on", "off": "turn_off", "toggle": "toggle"}.get(action_l, action_l)

        payload = {"entity_id": entity_ids}
        if entity_domain == "light" and service == "turn_on":
            if brightness_pct is not None:
                payload["brightness_pct"] = brightness_pct
            if color:
                payload["color_name"] = color
            if effect:
                payload["effect"] = effect

        try:
            resp = requests.post(
                f"{self.valves.ha_url}/api/services/{entity_domain}/{service}",
                headers=self._headers(),
                json=payload,
                timeout=10,
            )
            resp.raise_for_status()
        except Exception as e:
            return f"Error calling Home Assistant service: {e}"

        if len(matches) == 1:
            friendly = matches[0].get("attributes", {}).get("friendly_name", entity_ids[0])
            return f"Done — {service} called on {friendly} ({entity_ids[0]})."

        friendlies = ", ".join(
            m.get("attributes", {}).get("friendly_name", m["entity_id"]) for m in matches
        )
        return f"Done — {service} called on {len(matches)} devices: {friendlies}."

    def control_media_player(self, name: str, action: str) -> str:
        """
        Control a media player / speaker, e.g. "play music on the receiver", "pause the
        den speaker", "turn up the volume on the amp", "skip to the next track".

        :param name: The media player's everyday name, e.g. "receiver", "den speaker", "amp". Partial names are fine.
        :param action: One of: "play", "pause", "stop", "next", "previous", "volume_up", "volume_down", "mute", "unmute".
        """
        if not self.valves.ha_token:
            return "Error: Home Assistant token is not configured. Set it in this tool's Valves settings."
        try:
            matches = self._find_entities(name, domain="media_player")
        except Exception as e:
            return f"Error reaching Home Assistant: {e}"

        if not matches:
            return f"No media player found matching '{name}'."

        entity_ids = [m["entity_id"] for m in matches]
        service_map = {
            "play": "media_play",
            "pause": "media_pause",
            "stop": "media_stop",
            "next": "media_next_track",
            "previous": "media_previous_track",
            "volume_up": "volume_up",
            "volume_down": "volume_down",
            "mute": "volume_mute",
            "unmute": "volume_mute",
        }
        service = service_map.get(action.strip().lower())
        if not service:
            return f"Unknown action '{action}'. Use one of: {', '.join(service_map.keys())}."

        payload = {"entity_id": entity_ids}
        if service == "volume_mute":
            payload["is_volume_muted"] = action.strip().lower() == "mute"

        try:
            resp = requests.post(
                f"{self.valves.ha_url}/api/services/media_player/{service}",
                headers=self._headers(),
                json=payload,
                timeout=10,
            )
            resp.raise_for_status()
        except Exception as e:
            return f"Error calling Home Assistant service: {e}"

        friendlies = ", ".join(
            m.get("attributes", {}).get("friendly_name", m["entity_id"]) for m in matches
        )
        return f"Done — {service} called on: {friendlies}."

    def list_entities(self, domain: str = "") -> str:
        """
        List Home Assistant entities and their current state. Optionally filter by
        domain (e.g. "light", "switch", "climate", "sensor", "lock", "cover").

        :param domain: Optional domain to filter by, e.g. "light". Leave empty to list everything.
        """
        if not self.valves.ha_token:
            return "Error: Home Assistant token is not configured. Set it in this tool's Valves settings."
        try:
            resp = requests.get(
                f"{self.valves.ha_url}/api/states", headers=self._headers(), timeout=10
            )
            resp.raise_for_status()
            states = resp.json()
        except Exception as e:
            return f"Error reaching Home Assistant: {e}"

        if domain:
            states = [s for s in states if s["entity_id"].startswith(f"{domain}.")]

        if not states:
            return f"No entities found{f' for domain {domain}' if domain else ''}."

        lines = [f"{s['entity_id']}: {s['state']}" for s in states[:100]]
        return "\n".join(lines)

    def get_entity_state(self, entity_id: str) -> str:
        """
        Get the current state and attributes of a specific Home Assistant entity.

        :param entity_id: The entity ID, e.g. "light.living_room" or "sensor.living_room_temperature".
        """
        if not self.valves.ha_token:
            return "Error: Home Assistant token is not configured. Set it in this tool's Valves settings."
        try:
            resp = requests.get(
                f"{self.valves.ha_url}/api/states/{entity_id}",
                headers=self._headers(),
                timeout=10,
            )
            if resp.status_code == 404:
                return f"Entity '{entity_id}' not found."
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            return f"Error reaching Home Assistant: {e}"

        return f"{data['entity_id']}: {data['state']}\nAttributes: {data.get('attributes', {})}"

    def call_service(self, domain: str, service: str, entity_id: str) -> str:
        """
        Call a Home Assistant service on an entity. Use this to control devices, e.g.
        turn lights/switches on or off, lock/unlock locks, open/close covers, etc.
        Common services: "turn_on", "turn_off", "toggle", "lock", "unlock", "open_cover", "close_cover".

        :param domain: The entity's domain, e.g. "light", "switch", "lock", "cover", "climate".
        :param service: The service to call, e.g. "turn_on", "turn_off", "toggle".
        :param entity_id: The entity ID to act on, e.g. "light.living_room".
        """
        if not self.valves.ha_token:
            return "Error: Home Assistant token is not configured. Set it in this tool's Valves settings."
        try:
            resp = requests.post(
                f"{self.valves.ha_url}/api/services/{domain}/{service}",
                headers=self._headers(),
                json={"entity_id": entity_id},
                timeout=10,
            )
            resp.raise_for_status()
        except Exception as e:
            return f"Error calling Home Assistant service: {e}"

        return f"Called {domain}.{service} on {entity_id}."
