<?php
// Beim Löschen des Plugins: Einstellungen (inkl. Samsara-Token) entfernen.
if (!defined('WP_UNINSTALL_PLUGIN')) {
	exit;
}
delete_option('milo_busgps');
delete_transient('milo_busgps_fz');
