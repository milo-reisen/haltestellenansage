<?php
/**
 * Plugin Name: Milo Bus-GPS (Samsara)
 * Description: Liefert die GPS-Position der Busse aus Samsara an die Haltestellenansage-App (milo-reisen.github.io/haltestellenansage). Der Samsara-Schlüssel bleibt auf dem Server.
 * Version: 1.0.0
 * Author: Milo Reisen
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 * Text Domain: milo-busgps
 */

if (!defined('ABSPATH')) {
	exit;
}

final class Milo_BusGPS {
	const OPTION   = 'milo_busgps';
	const VERSION  = '1.0.0';
	const APP_URL  = 'https://milo-reisen.github.io/haltestellenansage/';
	const SERVER   = array('eu' => 'https://api.eu.samsara.com', 'us' => 'https://api.samsara.com');
	/** Seiten, die die Position abfragen dürfen (Browser-Herkunft). */
	const HERKUNFT = array('https://milo-reisen.github.io');

	public static function start() {
		add_action('admin_menu', array(__CLASS__, 'menue'));
		add_action('admin_post_milo_busgps_speichern', array(__CLASS__, 'speichern'));
		foreach (array('fahrzeuge', 'position') as $was) {
			add_action('wp_ajax_milo_busgps_' . $was, array(__CLASS__, 'ajax_' . $was));
			add_action('wp_ajax_nopriv_milo_busgps_' . $was, array(__CLASS__, 'ajax_' . $was));
		}
		add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
			array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=milo-busgps')) . '">Einstellungen</a>');
			return $links;
		});
	}

	/* ---------- Einstellungen ---------- */

	public static function opt() {
		$o = get_option(self::OPTION, array());
		$o = is_array($o) ? $o : array();
		$o = wp_parse_args($o, array('token' => '', 'region' => 'auto', 'region_ok' => '', 'schluessel' => '', 'app_url' => self::APP_URL));
		if ($o['schluessel'] === '') {
			$o['schluessel'] = self::neuer_schluessel();
			update_option(self::OPTION, $o, false);
		}
		return $o;
	}

	private static function neuer_schluessel() {
		return bin2hex(random_bytes(16));
	}

	public static function aktivieren() {
		self::opt();
	}

	public static function menue() {
		add_options_page('Bus-GPS (Samsara)', 'Bus-GPS (Samsara)', 'manage_options', 'milo-busgps', array(__CLASS__, 'seite'));
	}

	public static function einrichtungslink($o = null) {
		$o = $o ?: self::opt();
		$daten = wp_json_encode(array('s' => admin_url('admin-ajax.php'), 'k' => $o['schluessel']));
		$b64 = rtrim(strtr(base64_encode($daten), '+/', '-_'), '=');
		return trailingslashit($o['app_url']) . '#einrichten=' . $b64;
	}

	public static function speichern() {
		if (!current_user_can('manage_options')) {
			wp_die('Keine Berechtigung.');
		}
		check_admin_referer('milo_busgps_speichern');
		$o = self::opt();
		$token = isset($_POST['token']) ? trim(wp_unslash($_POST['token'])) : '';
		if ($token !== '') {
			$o['token'] = sanitize_text_field($token);
			$o['region_ok'] = '';
		}
		if (!empty($_POST['token_loeschen'])) {
			$o['token'] = '';
			$o['region_ok'] = '';
		}
		$region = isset($_POST['region']) ? sanitize_key(wp_unslash($_POST['region'])) : 'auto';
		$o['region'] = in_array($region, array('auto', 'eu', 'us'), true) ? $region : 'auto';
		if ($o['region'] !== 'auto') {
			$o['region_ok'] = '';
		}
		if (!empty($_POST['neuer_schluessel'])) {
			$o['schluessel'] = self::neuer_schluessel();
		}
		$app = isset($_POST['app_url']) ? esc_url_raw(trim(wp_unslash($_POST['app_url']))) : '';
		$o['app_url'] = $app ?: self::APP_URL;
		update_option(self::OPTION, $o, false);
		delete_transient('milo_busgps_fz');
		wp_safe_redirect(admin_url('options-general.php?page=milo-busgps&gespeichert=1'));
		exit;
	}

	public static function seite() {
		if (!current_user_can('manage_options')) {
			return;
		}
		$o = self::opt();
		$test = null;
		if (!empty($_GET['pruefen']) && $o['token'] !== '') {
			$test = self::fahrzeuge_holen(true);
		}
		$link = self::einrichtungslink($o);
		?>
		<div class="wrap">
			<h1>Bus-GPS (Samsara)</h1>
			<p>Dieses Plugin holt die GPS-Position der Busse aus Samsara und gibt sie an die
				<a href="<?php echo esc_url($o['app_url']); ?>" target="_blank" rel="noopener">Haltestellenansage-App</a> weiter.
				Der Samsara-Schlüssel bleibt hier auf dem Server; die Tablets bekommen nur die Position ihres Busses.</p>
			<?php if (!empty($_GET['gespeichert'])) : ?>
				<div class="notice notice-success"><p>Gespeichert.</p></div>
			<?php endif; ?>

			<h2>1. Samsara-Zugang</h2>
			<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
				<input type="hidden" name="action" value="milo_busgps_speichern">
				<?php wp_nonce_field('milo_busgps_speichern'); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="token">API-Token</label></th>
						<td>
							<input type="password" id="token" name="token" class="regular-text" autocomplete="off"
								placeholder="<?php echo $o['token'] ? '•••••••• (gespeichert – nur zum Ändern ausfüllen)' : 'samsara_api_…'; ?>">
							<p class="description">In Samsara: Einstellungen → API-Token → „API-Token hinzufügen“. Nur Leserechte nötig:
								<strong>Fahrzeuge lesen</strong> und <strong>Fahrzeugstatistiken lesen</strong> (Read Vehicles, Read Vehicle Statistics).</p>
							<?php if ($o['token']) : ?>
								<label><input type="checkbox" name="token_loeschen" value="1"> Token löschen</label>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="region">Samsara-Region</label></th>
						<td>
							<select id="region" name="region">
								<option value="auto" <?php selected($o['region'], 'auto'); ?>>automatisch erkennen</option>
								<option value="eu" <?php selected($o['region'], 'eu'); ?>>Europa (cloud.eu.samsara.com)</option>
								<option value="us" <?php selected($o['region'], 'us'); ?>>USA (cloud.samsara.com)</option>
							</select>
							<?php if ($o['region_ok']) : ?><p class="description">Erkannt: <?php echo esc_html(strtoupper($o['region_ok'])); ?></p><?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="app_url">Adresse der App</label></th>
						<td><input type="url" id="app_url" name="app_url" class="regular-text" value="<?php echo esc_attr($o['app_url']); ?>"></td>
					</tr>
				</table>
				<?php submit_button('Speichern'); ?>

				<h2>2. Verbindung prüfen</h2>
				<?php if (!$o['token']) : ?>
					<p>Zuerst das API-Token eintragen und speichern.</p>
				<?php else : ?>
					<p><a class="button" href="<?php echo esc_url(admin_url('options-general.php?page=milo-busgps&pruefen=1')); ?>">Fahrzeuge aus Samsara abrufen</a></p>
					<?php if ($test !== null) : ?>
						<?php if (is_wp_error($test)) : ?>
							<div class="notice notice-error inline"><p><?php echo esc_html($test->get_error_message()); ?></p></div>
						<?php else : ?>
							<div class="notice notice-success inline"><p>Verbindung klappt – <?php echo count($test); ?> Fahrzeuge gefunden.</p></div>
							<table class="widefat striped" style="max-width:820px">
								<thead><tr><th>Fahrzeug</th><th>Kennzeichen</th><th>Letzte Position</th></tr></thead>
								<tbody>
								<?php foreach ($test as $f) : ?>
									<tr>
										<td><?php echo esc_html($f['name']); ?></td>
										<td><?php echo esc_html($f['kennzeichen']); ?></td>
										<td><?php echo isset($f['ort']) ? esc_html($f['ort']) : '–'; ?></td>
									</tr>
								<?php endforeach; ?>
								</tbody>
							</table>
						<?php endif; ?>
					<?php endif; ?>
				<?php endif; ?>

				<h2>3. Tablets einrichten</h2>
				<p>Diesen Link <strong>auf dem Tablet im Bus</strong> öffnen (z.&nbsp;B. per E-Mail oder WhatsApp an das Tablet schicken).
					Die App merkt sich die Verbindung; danach wählt man dort einmal, in welchem Bus das Tablet hängt.</p>
				<p><input type="text" class="large-text code" readonly onclick="this.select()" value="<?php echo esc_attr($link); ?>"></p>
				<p><label><input type="checkbox" name="neuer_schluessel" value="1"> Neuen App-Schlüssel erzeugen
					(alte Links und eingerichtete Tablets funktionieren dann nicht mehr) – mit „Speichern“ oben bestätigen.</label></p>
			</form>
		</div>
		<?php
	}

	/* ---------- Samsara ---------- */

	private static function samsara($pfad) {
		$o = self::opt();
		if ($o['token'] === '') {
			return new WP_Error('kein_token', 'In WordPress ist noch kein Samsara-Token eingetragen.');
		}
		if ($o['region'] !== 'auto') {
			$regionen = array($o['region']);
		} elseif ($o['region_ok']) {
			$regionen = array($o['region_ok']);
		} else {
			$regionen = array('eu', 'us');
		}
		$letzter = null;
		foreach ($regionen as $r) {
			$res = wp_remote_get(self::SERVER[$r] . $pfad, array(
				'timeout' => 8,
				'headers' => array('Authorization' => 'Bearer ' . $o['token'], 'Accept' => 'application/json'),
			));
			if (is_wp_error($res)) {
				$letzter = new WP_Error('netz', 'Samsara nicht erreichbar: ' . $res->get_error_message());
				continue;
			}
			$code = wp_remote_retrieve_response_code($res);
			if ($code === 401) {
				$letzter = new WP_Error('token', 'Samsara lehnt das Token ab (falsche Region oder Token ungültig).');
				continue;
			}
			if ($code === 403) {
				return new WP_Error('rechte', 'Dem Samsara-Token fehlen Rechte: „Fahrzeuge lesen“ und „Fahrzeugstatistiken lesen“.');
			}
			if ($code === 429) {
				return new WP_Error('zuviel', 'Samsara: zu viele Anfragen, kurz warten.');
			}
			if ($code < 200 || $code >= 300) {
				$letzter = new WP_Error('samsara', 'Samsara antwortet mit Fehler ' . $code . '.');
				continue;
			}
			if ($o['region'] === 'auto' && $o['region_ok'] !== $r) {
				$o['region_ok'] = $r;
				update_option(self::OPTION, $o, false);
			}
			$json = json_decode(wp_remote_retrieve_body($res), true);
			return is_array($json) ? $json : new WP_Error('samsara', 'Unerwartete Antwort von Samsara.');
		}
		return $letzter ?: new WP_Error('samsara', 'Keine Antwort von Samsara.');
	}

	private static function gps_daten($gps) {
		if (!is_array($gps) || !isset($gps['latitude'], $gps['longitude'])) {
			return null;
		}
		$t = isset($gps['time']) ? strtotime($gps['time']) : false;
		return array(
			'lat'      => (float) $gps['latitude'],
			'lon'      => (float) $gps['longitude'],
			'richtung' => isset($gps['headingDegrees']) ? (float) $gps['headingDegrees'] : null,
			'kmh'      => isset($gps['speedMilesPerHour']) ? round((float) $gps['speedMilesPerHour'] * 1.609344, 1) : null,
			'alter_s'  => $t ? max(0, microtime(true) - $t) : null,
			'ort'      => isset($gps['reverseGeo']['formattedLocation']) ? (string) $gps['reverseGeo']['formattedLocation'] : '',
		);
	}

	/** Alle Fahrzeuge mit letzter Position (für die Auswahl auf dem Tablet). */
	public static function fahrzeuge_holen($frisch = false) {
		$c = $frisch ? false : get_transient('milo_busgps_fz');
		if (is_array($c)) {
			return $c;
		}
		$liste = array();
		$nach = '';
		for ($seite = 0; $seite < 5; $seite++) {
			$j = self::samsara('/fleet/vehicles?limit=512' . ($nach ? '&after=' . rawurlencode($nach) : ''));
			if (is_wp_error($j)) {
				return $j;
			}
			foreach ((array) ($j['data'] ?? array()) as $v) {
				$liste[(string) $v['id']] = array(
					'id'          => (string) $v['id'],
					'name'        => (string) ($v['name'] ?? $v['id']),
					'kennzeichen' => (string) ($v['licensePlate'] ?? ''),
				);
			}
			$nach = $j['pagination']['endCursor'] ?? '';
			if (empty($j['pagination']['hasNextPage'])) {
				break;
			}
		}
		$s = self::samsara('/fleet/vehicles/stats?types=gps');
		if (!is_wp_error($s)) {
			foreach ((array) ($s['data'] ?? array()) as $v) {
				$id = (string) ($v['id'] ?? '');
				$g = self::gps_daten($v['gps'] ?? null);
				if ($id !== '' && $g && isset($liste[$id])) {
					$liste[$id] += array('lat' => $g['lat'], 'lon' => $g['lon'], 'ort' => $g['ort']);
				}
			}
		}
		$liste = array_values($liste);
		usort($liste, function ($a, $b) { return strnatcasecmp($a['name'], $b['name']); });
		set_transient('milo_busgps_fz', $liste, 5 * MINUTE_IN_SECONDS);
		return $liste;
	}

	/* ---------- Schnittstelle für die App ---------- */

	private static function antwort($daten, $status = 200) {
		$herkunft = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
		if (in_array($herkunft, self::HERKUNFT, true) || preg_match('#^http://(localhost|127\.0\.0\.1)(:\d+)?$#', $herkunft)) {
			header('Access-Control-Allow-Origin: ' . $herkunft);
			header('Vary: Origin');
		}
		header('Cache-Control: no-store');
		wp_send_json($daten, $status);
	}

	private static function pruefe_schluessel() {
		$o = self::opt();
		$k = isset($_POST['schluessel']) ? (string) wp_unslash($_POST['schluessel']) : '';
		if ($k === '' || !hash_equals($o['schluessel'], $k)) {
			self::antwort(array('ok' => false, 'fehler' => 'App-Schlüssel stimmt nicht. Tablet mit dem Link aus WordPress neu einrichten.'), 403);
		}
	}

	public static function ajax_fahrzeuge() {
		self::pruefe_schluessel();
		$l = self::fahrzeuge_holen();
		if (is_wp_error($l)) {
			self::antwort(array('ok' => false, 'fehler' => $l->get_error_message()), 502);
		}
		self::antwort(array('ok' => true, 'fahrzeuge' => $l));
	}

	public static function ajax_position() {
		self::pruefe_schluessel();
		$id = isset($_POST['fahrzeug']) ? preg_replace('/[^0-9A-Za-z_\-:.]/', '', (string) wp_unslash($_POST['fahrzeug'])) : '';
		if ($id === '') {
			self::antwort(array('ok' => false, 'fehler' => 'Kein Fahrzeug gewählt.'), 400);
		}
		// Mehrere Tablets im selben Bus oder schnelle Abfragen: höchstens alle 2 Sekunden zu Samsara.
		$schl = 'milo_busgps_p_' . md5($id);
		$c = get_transient($schl);
		if (is_array($c) && isset($c['geholt']) && microtime(true) - $c['geholt'] < 2) {
			$g = $c['gps'];
			$g['alter_s'] = $g['alter_s'] !== null ? $g['alter_s'] + (microtime(true) - $c['geholt']) : null;
			self::antwort(array('ok' => true) + $g);
		}
		$j = self::samsara('/fleet/vehicles/stats?types=gps&vehicleIds=' . rawurlencode($id));
		if (is_wp_error($j)) {
			self::antwort(array('ok' => false, 'fehler' => $j->get_error_message()), 502);
		}
		$g = null;
		foreach ((array) ($j['data'] ?? array()) as $v) {
			if ((string) ($v['id'] ?? '') === $id || (string) ($v['externalIds']['samsara.serial'] ?? '') === $id) {
				$g = self::gps_daten($v['gps'] ?? null);
				break;
			}
		}
		if (!$g) {
			self::antwort(array('ok' => false, 'fehler' => 'Für dieses Fahrzeug liefert Samsara gerade keine Position.'), 404);
		}
		set_transient($schl, array('geholt' => microtime(true), 'gps' => $g), 10);
		self::antwort(array('ok' => true) + $g);
	}
}

register_activation_hook(__FILE__, array('Milo_BusGPS', 'aktivieren'));
Milo_BusGPS::start();
