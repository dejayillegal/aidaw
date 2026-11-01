import unittest
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('verify_apk', Path(__file__).with_name('verify-apk.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
parse_signer_certificate = module.parse_signer_certificate

class SignerOutputTests(unittest.TestCase):
    def test_legacy_output(self):
        self.assertEqual(parse_signer_certificate('Number of signers: 1\nSigner #1 certificate SHA-256 digest: ' + 'a'*64), 'a'*64)
    def test_sdk_range_and_repeated_scheme(self):
        line = 'Signer (minSdkVersion=24, maxSdkVersion=2147483647) #1 certificate SHA-256 digest: ' + 'A'*64
        self.assertEqual(parse_signer_certificate(line+'\n'+line), 'a'*64)
    def test_source_stamp_is_not_an_app_signer(self):
        signature = 'Signer #1 certificate SHA-256 digest: ' + 'a'*64 + '\nSource Stamp Signer certificate SHA-256 digest: ' + 'b'*64
        self.assertEqual(parse_signer_certificate(signature), 'a'*64)
    def test_distinct_signers_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_signer_certificate('Signer #1 certificate SHA-256 digest: ' + 'a'*64 + '\nSigner #2 certificate SHA-256 digest: ' + 'b'*64)
    def test_reported_multiple_signers_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_signer_certificate('Number of signers: 2\nSigner #1 certificate SHA-256 digest: ' + 'a'*64)
    def test_no_certificate_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_signer_certificate('Verified using v2 scheme: true')

if __name__ == '__main__': unittest.main()
