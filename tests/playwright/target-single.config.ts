export default {
	targets: [
		{
			id: 'only',
			name: 'Only',
			command: [
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'printf "explicit-single-ready\\n"; exec bash --norc --noprofile',
			],
			imageDrop: 'disabled',
		},
	],
	defaultTargetId: 'only',
}
