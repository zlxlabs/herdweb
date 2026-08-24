export default {
	targets: [
		{
			id: 'one',
			name: 'One',
			command: [
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'printf "target-one-ready\\n"; exec bash --norc --noprofile',
			],
			imageDrop: 'disabled',
		},
		{
			id: 'two',
			name: 'Two',
			command: [
				'bash',
				'--norc',
				'--noprofile',
				'-lc',
				'printf "target-two-ready\\n"; exec bash --norc --noprofile',
			],
			imageDrop: 'disabled',
		},
	],
	defaultTargetId: 'one',
}
